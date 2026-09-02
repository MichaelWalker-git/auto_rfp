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

export interface GoogleDriveSyncStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  /** Bucket holding RFP document HTML and images — required, see below. */
  documentsBucketName: string;
  /** Queue the blocked-approval notifications are published to. */
  notificationQueueName: string;
  commonEnv: Record<string, string>;
  /** Poll interval; 15 minutes matches the product decision. */
  scheduleMinutes?: number;
}

/**
 * Scheduled import of Google Drive edits into AutoRFP — the half of the bidirectional
 * link that no user action triggers.
 *
 * This is a standalone stack rather than another route on the API, because it has no
 * caller: EventBridge invokes it every 15 minutes, it enumerates linked documents via
 * the sparse `byDriveSync` index, and it writes as `system`. Consequently it inherits
 * **nothing** from `commonLambdaRole` and needs each grant spelled out here.
 *
 * The one non-obvious requirement: `DOCUMENTS_BUCKET` must be in the environment.
 * `helpers/rfp-document.ts`, `helpers/rfp-document-version.ts`, `helpers/export.ts` and
 * `helpers/google-drive-document-sync.ts` all call `requireEnv('DOCUMENTS_BUCKET')` at
 * module load, and the app's shared `commonEnv` does not carry it — so omitting it is a
 * cold-start crash before a single document is examined, not a runtime error later.
 */
export class GoogleDriveSyncStack extends cdk.Stack {
  public readonly pollLambda: lambdaNodejs.NodejsFunction;

  constructor(scope: Construct, id: string, props: GoogleDriveSyncStackProps) {
    super(scope, id, props);

    const {
      stage,
      mainTable,
      documentsBucketName,
      notificationQueueName,
      commonEnv,
      scheduleMinutes = 15,
    } = props;

    const functionName = `auto-rfp-gdrive-poll-${stage}`;

    // 1. Execution role — own role, no AWS managed policies, least privilege.
    const lambdaRole = new iam.Role(this, 'GoogleDriveSyncLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    // CloudWatch Logs (replaces AWSLambdaBasicExecutionRole), scoped to this function.
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${functionName}:*`,
        ],
      }),
    );

    // Documents, versions, and the audit trail all live in the single table; the poller
    // also reads the byDriveSync index, which grantReadWriteData covers.
    mainTable.grantReadWriteData(lambdaRole);

    // Only the Google service-account credentials. Deliberately narrower than the
    // `*-api-key-*` wildcard on commonLambdaRole: this function has no business
    // reading the Linear, SAM.gov, or HigherGov keys.
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [
          `arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:google-api-key-*`,
        ],
      }),
    );

    // Document HTML, version snapshots, and images pulled out of Drive. Scoped to the
    // rfp-documents prefix under org/project/opportunity rather than the whole bucket.
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:PutObject'],
        resources: [`arn:aws:s3:::${documentsBucketName}/*/*/*/rfp-documents/*`],
      }),
    );

    // The audit log's integrity HMAC key.
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameter', 'ssm:GetParameters'],
        resources: [`arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/auto-rfp/*`],
      }),
    );

    // Notifying approvers that a Drive edit was blocked.
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage'],
        resources: [
          `arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${notificationQueueName}`,
        ],
      }),
    );

    // 2. Log group with controlled retention.
    const logGroup = new logs.LogGroup(this, 'GoogleDriveSyncLogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 3. The poller. 1024 MB because a pass holds a whole exported DOCX plus the
    // mammoth conversion in memory; 5 minutes because it walks every org in sequence.
    this.pollLambda = new lambdaNodejs.NodejsFunction(this, 'GoogleDriveSyncFn', {
      functionName,
      entry: path.join(
        __dirname,
        '../../apps/functions/src/handlers/google/poll-google-drive-changes.ts',
      ),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        DOCUMENTS_BUCKET: documentsBucketName,
        NOTIFICATION_QUEUE_URL: `https://sqs.${cdk.Aws.REGION}.amazonaws.com/${cdk.Aws.ACCOUNT_ID}/${notificationQueueName}`,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
        // mammoth is bundled inline, NOT listed in nodeModules — matching the three
        // handlers already shipping it (convert-to-content, reprocess-form,
        // render-docx-form), none of which declare it. It has no dynamic requires that
        // defeat esbuild, so there is nothing to gain, and declaring it opts into CDK's
        // pnpm-install-into-a-temp-dir bundling path for no reason.
      },
    });

    this.pollLambda.node.addDependency(logGroup);

    // 4. The schedule. retryAttempts: 1 because the handler never throws on a
    // per-org or per-document failure — a retry would only re-run an entire pass.
    const scheduleRule = new events.Rule(this, 'GoogleDriveSyncRule', {
      ruleName: functionName,
      description: `Imports Google Drive document edits into AutoRFP every ${scheduleMinutes} minutes`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(scheduleMinutes)),
    });

    scheduleRule.addTarget(new targets.LambdaFunction(this.pollLambda, { retryAttempts: 1 }));

    // CDK NAG suppressions (IAM5 wildcards, L1 runtime) are applied stack-wide from
    // the bin via addLambdaSuppressions + addDynamoDBSuppressions, as elsewhere.

    new cdk.CfnOutput(this, 'GoogleDriveSyncLambdaArn', {
      value: this.pollLambda.functionArn,
      description: 'Lambda ARN for the scheduled Google Drive → AutoRFP import',
    });
  }
}
