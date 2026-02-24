import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as path from 'path';

export interface CollaborationWebSocketStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  /** ARN of the shared Lambda execution role from ApiOrchestratorStack */
  commonLambdaRoleArn: string;
  commonEnv: Record<string, string>;
  /**
   * Notification queue name — plain string to avoid cross-stack token cycles.
   * The queue URL and ARN are constructed from this name + pseudo-parameters.
   */
  notificationQueueName: string;
}

export class CollaborationWebSocketStack extends cdk.Stack {
  public readonly wsApiEndpoint: string;
  public readonly wsApiUrl: string;
  public readonly notificationQueueUrl: string;

  constructor(scope: Construct, id: string, props: CollaborationWebSocketStackProps) {
    super(scope, id, props);

    const { stage, commonLambdaRoleArn, commonEnv, notificationQueueName } = props;

    // Resolve the shared Lambda role within this Stack's scope
    const lambdaRole = iam.Role.fromRoleArn(this, 'SharedLambdaRole', commonLambdaRoleArn);

    // Construct queue URL and ARN from the name — no cross-stack token reference
    const notificationQueueUrl = `https://sqs.${cdk.Aws.REGION}.amazonaws.com/${cdk.Aws.ACCOUNT_ID}/${notificationQueueName}`;
    const notificationQueueArn = `arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${notificationQueueName}`;

    // Import the queue by ARN so we can attach event sources
    const notificationQueue = sqs.Queue.fromQueueArn(this, 'NotificationQueue', notificationQueueArn);

    this.notificationQueueUrl = notificationQueueUrl;

    const bundling = {
      minify: true,
      sourceMap: true,
      externalModules: ['@aws-sdk/*'],
    };

    // ── Lambda: WS JWT Authorizer ─────────────────────────────────────────────
    const authorizerFn = new lambdaNodejs.NodejsFunction(this, 'WsAuthorizerFn', {
      functionName: `auto-rfp-ws-authorizer-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/ws-authorizer.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(5),
      memorySize: 128,
      role: lambdaRole,
      environment: {
        COGNITO_USER_POOL_ID: commonEnv['COGNITO_USER_POOL_ID'] ?? '',
        REGION: commonEnv['REGION'] ?? 'us-east-1',
      },
      bundling,
    });

    new logs.LogGroup(this, 'WsAuthorizerLogs', {
      logGroupName: `/aws/lambda/${authorizerFn.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Lambda: $connect ──────────────────────────────────────────────────────
    const connectFn = new lambdaNodejs.NodejsFunction(this, 'WsConnect', {
      functionName: `auto-rfp-ws-connect-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/ws-connect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: lambdaRole,
      environment: commonEnv,
      bundling,
    });

    new logs.LogGroup(this, 'WsConnectLogs', {
      logGroupName: `/aws/lambda/${connectFn.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Lambda: $disconnect ───────────────────────────────────────────────────
    const disconnectFn = new lambdaNodejs.NodejsFunction(this, 'WsDisconnect', {
      functionName: `auto-rfp-ws-disconnect-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/ws-disconnect.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      role: lambdaRole,
      environment: commonEnv,
      bundling,
    });

    new logs.LogGroup(this, 'WsDisconnectLogs', {
      logGroupName: `/aws/lambda/${disconnectFn.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── Lambda: $default (messages) ───────────────────────────────────────────
    const messageFn = new lambdaNodejs.NodejsFunction(this, 'WsMessage', {
      functionName: `auto-rfp-ws-message-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/ws-message.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(29),
      memorySize: 512,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        WS_API_ENDPOINT: 'PLACEHOLDER', // overridden after API creation
      },
      bundling,
    });

    new logs.LogGroup(this, 'WsMessageLogs', {
      logGroupName: `/aws/lambda/${messageFn.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ── WebSocket API ─────────────────────────────────────────────────────────
    const wsApi = new apigwv2.WebSocketApi(this, 'CollaborationWsApi', {
      apiName: `auto-rfp-collaboration-ws-${stage}`,
      connectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('ConnectIntegration', connectFn),
        authorizer: new apigwv2Authorizers.WebSocketLambdaAuthorizer('WsAuthorizer', authorizerFn, {
          identitySource: ['route.request.querystring.token'],
        }),
      },
      disconnectRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectFn),
      },
      defaultRouteOptions: {
        integration: new apigwv2Integrations.WebSocketLambdaIntegration('MessageIntegration', messageFn),
      },
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'WsStage', {
      webSocketApi: wsApi,
      stageName: stage,
      autoDeploy: true,
    });

    this.wsApiEndpoint = wsStage.callbackUrl;
    this.wsApiUrl = wsStage.url;

    messageFn.addEnvironment('WS_API_ENDPOINT', this.wsApiEndpoint);

    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${wsApi.apiId}/${stage}/POST/@connections/*`,
        ],
      }),
    );

    // ── SQS Notification Worker ───────────────────────────────────────────────
    const notificationWorker = new lambdaNodejs.NodejsFunction(this, 'NotificationWorker', {
      functionName: `auto-rfp-collab-notification-worker-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/collaboration/notification-worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        NOTIFICATION_FROM_EMAIL: 'noreply@auto-rfp.com',
        NOTIFICATION_QUEUE_URL: notificationQueueUrl,
      },
      bundling,
    });

    new logs.LogGroup(this, 'NotificationWorkerLogs', {
      logGroupName: `/aws/lambda/${notificationWorker.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    notificationWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(notificationQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    // Grant SQS permissions via IAM policy (no cross-stack grant call)
    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'NotificationQueueAccess',
        actions: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
        resources: [notificationQueueArn],
      }),
    );

    // Grant SES send permission
    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

    // ── EventBridge: Deadline Alert Scanner ───────────────────────────────────
    const deadlineAlertScanner = new lambdaNodejs.NodejsFunction(this, 'DeadlineAlertScanner', {
      functionName: `auto-rfp-deadline-alert-scanner-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/notification/deadline-alert-scanner.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 256,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        NOTIFICATION_QUEUE_URL: notificationQueueUrl,
      },
      bundling,
    });

    new logs.LogGroup(this, 'DeadlineAlertScannerLogs', {
      logGroupName: `/aws/lambda/${deadlineAlertScanner.functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new events.Rule(this, 'DeadlineAlertRule', {
      ruleName: `auto-rfp-deadline-alert-${stage}`,
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [new eventsTargets.LambdaFunction(deadlineAlertScanner)],
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'WsApiUrl', {
      value: this.wsApiUrl,
      description: 'WebSocket API URL for collaboration (wss://)',
    });

    new cdk.CfnOutput(this, 'WsCallbackUrl', {
      value: this.wsApiEndpoint,
      description: 'WebSocket callback URL for posting to connections (https://)',
    });

    new cdk.CfnOutput(this, 'NotificationQueueUrl', {
      value: notificationQueueUrl,
      description: 'SQS queue URL for collaboration notifications',
    });
  }
}
