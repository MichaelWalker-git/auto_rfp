import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

export interface RfpLinearSyncStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  commonEnv: Record<string, string>;
  /** AutoRFP org id whose board is populated (SK prefix). */
  rfpOrgId: string;
  /** Synthetic project id for the synced Opportunity records. */
  rfpProjectId: string;
  /** Org id whose Secrets Manager entry (`linear-api-key-<id>`) holds the key. */
  linearOrgId: string;
  /** Linear project name to mirror. */
  linearProjectName?: string;
  /** Look-back window in days. */
  windowDays?: number;
  /** Intake staleness cutoff in days — past-due/untouched intake → expired. 0 disables. */
  intakeStaleDays?: number;
}

/**
 * Scheduled sync of the Linear "Government Contracting" board into the
 * RFP-tracking pipeline:
 * - EventBridge rule: every 15 minutes
 * - Lambda: sync-linear-pipeline handler (reads Linear via Secrets Manager key,
 *   upserts one Opportunity per issue, prunes records outside the window)
 */
export class RfpLinearSyncStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: RfpLinearSyncStackProps) {
    super(scope, id, props);

    const {
      stage,
      mainTable,
      commonEnv,
      rfpOrgId,
      rfpProjectId,
      linearOrgId,
      linearProjectName = 'Government Contracting',
      windowDays = 14,
      intakeStaleDays = 21,
    } = props;

    // 1. Lambda execution role (no AWS managed policies)
    const lambdaRole = new iam.Role(this, 'RfpLinearSyncLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // CloudWatch Logs permissions (replaces AWSLambdaBasicExecutionRole)
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/auto-rfp-rfp-linear-sync-${stage}:*`,
        ],
      }),
    );

    // DynamoDB read/write for the single-table board records
    mainTable.grantReadWriteData(lambdaRole);

    // Read the Linear API key from Secrets Manager (linear-api-key-<orgId>)
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:${'linear-api-key-'}*`,
        ],
      }),
    );

    // 2. Log group with retention
    const logGroup = new logs.LogGroup(this, 'RfpLinearSyncLogGroup', {
      logGroupName: `/aws/lambda/auto-rfp-rfp-linear-sync-${stage}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. The sync Lambda
    const syncLambda = new lambdaNodejs.NodejsFunction(this, 'RfpLinearSyncFn', {
      functionName: `auto-rfp-rfp-linear-sync-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/rfp-tracking/sync-linear-pipeline.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        RFP_SYNC_ORG_ID: rfpOrgId,
        RFP_SYNC_PROJECT_ID: rfpProjectId,
        RFP_SYNC_LINEAR_ORG_ID: linearOrgId,
        RFP_SYNC_PROJECT_NAME: linearProjectName,
        RFP_SYNC_WINDOW_DAYS: String(windowDays),
        RFP_SYNC_INTAKE_STALE_DAYS: String(intakeStaleDays),
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });

    syncLambda.node.addDependency(logGroup);

    // 4. EventBridge rule — every 15 minutes
    const scheduleRule = new events.Rule(this, 'RfpLinearSyncRule', {
      ruleName: `auto-rfp-rfp-linear-sync-${stage}`,
      description: 'Syncs the Linear Government Contracting board into RFP tracking every 15 minutes',
      schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
    });

    scheduleRule.addTarget(new targets.LambdaFunction(syncLambda, { retryAttempts: 1 }));

    // CDK NAG suppressions (IAM5 wildcards for DynamoDB indexes / Secrets
    // Manager, L1 runtime) are applied stack-wide from the bin via
    // addLambdaSuppressions + addDynamoDBSuppressions, matching every other
    // stack in the app.

    // 5. Output
    new cdk.CfnOutput(this, 'RfpLinearSyncLambdaArn', {
      value: syncLambda.functionArn,
      description: 'Lambda ARN for the Linear → RFP-tracking board sync',
    });
  }
}
