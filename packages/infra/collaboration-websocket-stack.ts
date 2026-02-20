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
import * as path from 'path';

export interface CollaborationWebSocketStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  /** ARN of the shared Lambda execution role from ApiOrchestratorStack */
  commonLambdaRoleArn: string;
  commonEnv: Record<string, string>;
}

export class CollaborationWebSocketStack extends cdk.Stack {
  public readonly wsApiEndpoint: string;
  public readonly wsApiUrl: string;

  constructor(scope: Construct, id: string, props: CollaborationWebSocketStackProps) {
    super(scope, id, props);

    const { stage, commonLambdaRoleArn, commonEnv } = props;

    // Resolve the shared Lambda role within this Stack's scope
    const lambdaRole = iam.Role.fromRoleArn(this, 'SharedLambdaRole', commonLambdaRoleArn);

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
    // WS_API_ENDPOINT is injected after the API is created below
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

    this.wsApiEndpoint = wsStage.callbackUrl; // https://abc.execute-api.us-east-1.amazonaws.com/dev
    this.wsApiUrl = wsStage.url;              // wss://abc.execute-api.us-east-1.amazonaws.com/dev

    // Inject the WS callback URL into the message Lambda env
    messageFn.addEnvironment('WS_API_ENDPOINT', this.wsApiEndpoint);

    // Grant Lambda role permission to post to WebSocket connections
    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${wsApi.apiId}/${stage}/POST/@connections/*`,
        ],
      }),
    );

    // ── SQS Notification Queue + Worker ───────────────────────────────────────
    const notificationDLQ = new sqs.Queue(this, 'NotificationDLQ', {
      queueName: `auto-rfp-collab-notifications-dlq-${stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    const notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      queueName: `auto-rfp-collab-notifications-${stage}`,
      visibilityTimeout: cdk.Duration.seconds(60),
      deadLetterQueue: {
        queue: notificationDLQ,
        maxReceiveCount: 3,
      },
    });

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
        NOTIFICATION_QUEUE_URL: notificationQueue.queueUrl,
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

    notificationQueue.grantConsumeMessages(notificationWorker);
    notificationQueue.grantSendMessages(lambdaRole);

    // Grant SES send permission
    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      }),
    );

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
      value: notificationQueue.queueUrl,
      description: 'SQS queue URL for collaboration notifications',
    });
  }
}
