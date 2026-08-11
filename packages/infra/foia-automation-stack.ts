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

export interface FoiaAutomationStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  commonEnv: Record<string, string>;
  /** Documents bucket, read for the solicitation text scan. */
  documentsBucketName: string;
}

/**
 * Scheduled reconciler for automatic FOIA requests (Level 2).
 *
 * A daily EventBridge rule invokes a Lambda that recomputes the intended FOIA
 * automation state for every eligible opportunity. There is no Step Functions
 * timer: the wait is measured in months, far beyond any state machine's useful
 * range, and a nightly poll over a due-date field is both cheaper and
 * self-healing (a missed run is corrected by the next one).
 *
 * A plain `events.Rule` is used rather than EventBridge Scheduler because daily
 * reconciliation has no wall-clock or DST sensitivity — nothing here cares what
 * local time it runs at, only that it runs once a day.
 */
export class FoiaAutomationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FoiaAutomationStackProps) {
    super(scope, id, props);

    const { stage, mainTable, commonEnv, documentsBucketName } = props;

    const functionName = `auto-rfp-foia-scan-${stage}`;

    // 1. Execution role — no AWS managed policies.
    const lambdaRole = new iam.Role(this, 'FoiaAutomationLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // CloudWatch Logs (replaces AWSLambdaBasicExecutionRole).
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${functionName}:*`,
        ],
      }),
    );

    // The reconciler reads opportunities/submissions/settings and writes
    // automation records and the denormalized marker on the opportunity.
    mainTable.grantReadWriteData(lambdaRole);

    // Read-only on the documents bucket: the tier-3 recipient scan reads the
    // already-extracted solicitation text and never writes.
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${documentsBucketName}/*`],
      }),
    );

    // 2. Log group with controlled retention.
    const logGroup = new logs.LogGroup(this, 'FoiaAutomationLogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. The reconciler Lambda.
    const scanLambda = new lambdaNodejs.NodejsFunction(this, 'FoiaScanFn', {
      functionName,
      entry: path.join(
        __dirname,
        '../../apps/functions/src/handlers/foia/scan-foia-automation.ts',
      ),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      // Iterates every org sequentially; 5 minutes leaves headroom as the
      // table grows, and an incomplete pass is safe to repeat.
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        DOCUMENTS_BUCKET: documentsBucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });

    scanLambda.node.addDependency(logGroup);

    // 4. Daily schedule at 09:00 UTC.
    const scheduleRule = new events.Rule(this, 'FoiaScanRule', {
      ruleName: functionName,
      description:
        'Daily reconcile of automatic FOIA request scheduling across all organizations',
      schedule: events.Schedule.cron({ minute: '0', hour: '9' }),
    });

    scheduleRule.addTarget(
      new targets.LambdaFunction(scanLambda, {
        // `dryRun: false` mirrors run-saved-search: the same Lambda can be
        // invoked manually with `{ detail: { dryRun: true, orgId } }` to preview
        // a single tenant without persisting anything.
        event: events.RuleTargetInput.fromObject({ detail: { dryRun: false } }),
        retryAttempts: 1,
      }),
    );

    // 5. Output.
    new cdk.CfnOutput(this, 'FoiaScanLambdaArn', {
      value: scanLambda.functionArn,
      description: 'Lambda ARN for the daily FOIA automation reconciler',
    });
  }
}
