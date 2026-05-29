import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';
import { NagSuppressions } from 'cdk-nag';

export interface StaleContentDetectionStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  commonEnv: Record<string, string>;
  notificationEmail?: string;
}

/**
 * Stack for stale content detection infrastructure:
 * - EventBridge rule: Daily at 2am UTC
 * - Lambda: detect-stale-content handler
 * - SNS topic: notifications for content owners
 */
export class StaleContentDetectionStack extends cdk.Stack {
  public readonly snsTopicArn: string;

  constructor(scope: Construct, id: string, props: StaleContentDetectionStackProps) {
    super(scope, id, props);

    const { stage, mainTable, commonEnv, notificationEmail } = props;

    // 1. Create SNS Topic for stale content notifications with SSL enforcement
    const staleContentTopic = new sns.Topic(this, 'StaleContentTopic', {
      topicName: `auto-rfp-stale-content-${stage}`,
      displayName: 'Stale Content Alerts',
    });

    // Enforce SSL on SNS topic (AwsSolutions-SNS3)
    staleContentTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'EnforceSSL',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [staleContentTopic.topicArn],
        conditions: {
          Bool: { 'aws:SecureTransport': 'false' },
        },
      }),
    );

    this.snsTopicArn = staleContentTopic.topicArn;

    // Optionally add email subscription
    if (notificationEmail) {
      staleContentTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(notificationEmail),
      );
    }

    // 2. Create Lambda execution role with specific permissions (no AWS managed policies)
    const lambdaRole = new iam.Role(this, 'StaleContentLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // CloudWatch Logs permissions (replaces AWSLambdaBasicExecutionRole managed policy)
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'logs:CreateLogGroup',
          'logs:CreateLogStream',
          'logs:PutLogEvents',
        ],
        resources: [
          `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/auto-rfp-detect-stale-content-${stage}:*`,
        ],
      }),
    );

    // Grant DynamoDB access
    mainTable.grantReadWriteData(lambdaRole);

    // Grant SNS publish
    staleContentTopic.grantPublish(lambdaRole);

    // 3. Create the stale content detection Lambda
    const detectStaleContentLambda = new lambdaNodejs.NodejsFunction(this, 'DetectStaleContentFn', {
      functionName: `auto-rfp-detect-stale-content-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/content-library/detect-stale-content.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        STALE_CONTENT_SNS_TOPIC_ARN: staleContentTopic.topicArn,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
      },
    });

    // 4. Create EventBridge rule — daily at 2am UTC
    const dailyRule = new events.Rule(this, 'StaleContentDailyRule', {
      ruleName: `auto-rfp-stale-content-daily-${stage}`,
      description: 'Triggers stale content detection daily at 2am UTC',
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    dailyRule.addTarget(new targets.LambdaFunction(detectStaleContentLambda, {
      retryAttempts: 2,
    }));

    // ─── CDK NAG Suppressions ───
    NagSuppressions.addResourceSuppressions(
      lambdaRole,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'DynamoDB index wildcard is required for grantReadWriteData on single-table design with GSIs',
          appliesTo: [`Resource::<${cdk.Stack.of(this).getLogicalId(mainTable.node.defaultChild as cdk.CfnElement)}.Arn>/index/*`],
        },
      ],
      true,
    );

    // Outputs
    new cdk.CfnOutput(this, 'StaleContentSnsTopicArn', {
      value: staleContentTopic.topicArn,
      description: 'SNS Topic ARN for stale content notifications',
    });

    new cdk.CfnOutput(this, 'DetectStaleContentLambdaArn', {
      value: detectStaleContentLambda.functionArn,
      description: 'Lambda ARN for stale content detection',
    });
  }
}
