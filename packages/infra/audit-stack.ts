import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as path from 'path';
import * as crypto from 'crypto';

export interface AuditStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  commonLambdaRoleArn: string;
  commonEnv: Record<string, string>;
}

export class AuditStack extends cdk.Stack {
  public readonly auditQueueName: string;
  public readonly auditArchiveBucketName: string;

  constructor(scope: Construct, id: string, props: AuditStackProps) {
    super(scope, id, props);

    const { stage, mainTable, commonLambdaRoleArn, commonEnv } = props;
    const isProd = stage.toLowerCase() === 'prod';

    const lambdaRole = iam.Role.fromRoleArn(this, 'SharedLambdaRole', commonLambdaRoleArn);

    const bundling = {
      minify: true,
      sourceMap: true,
      externalModules: ['@aws-sdk/*'],
    };

    // ── SSM: HMAC secret for log integrity ────────────────────────────────────
    // Generate a random secret and store it in SSM Parameter Store.
    // In production, rotate this via a separate process.
    const hmacSecret = new ssm.StringParameter(this, 'AuditHmacSecret', {
      parameterName: `/auto-rfp/audit-hmac-secret-${stage.toLowerCase()}`,
      stringValue: crypto.randomBytes(32).toString('hex'),
      description: 'HMAC secret for audit log integrity hashing',
      tier: ssm.ParameterTier.STANDARD,
    });

    // Grant Lambda role access to read the HMAC secret
    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [hmacSecret.parameterArn],
    }));

    // ── S3: Audit Archive Bucket (Glacier cold storage) ───────────────────────
    const auditArchiveBucket = new s3.Bucket(this, 'AuditArchiveBucket', {
      bucketName: `auto-rfp-audit-archive-${stage.toLowerCase()}-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: isProd ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
      lifecycleRules: [
        {
          id: 'glacier-transition',
          // Objects are written directly as GLACIER_IR by the archiver Lambda.
          // This lifecycle rule transitions any STANDARD objects after 1 day
          // as a safety net, and expires objects after 7 years.
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL,
              transitionAfter: cdk.Duration.days(1),
            },
          ],
          expiration: cdk.Duration.days(365 * 7), // 7-year retention
        },
      ],
    });

    this.auditArchiveBucketName = auditArchiveBucket.bucketName;

    // Grant Lambda role write access to the archive bucket
    auditArchiveBucket.grantWrite(lambdaRole);

    // ── SQS: Audit Log Queue ──────────────────────────────────────────────────
    const auditLogDlq = new sqs.Queue(this, 'AuditLogDLQ', {
      queueName: `auto-rfp-audit-log-dlq-${stage.toLowerCase()}`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    const auditLogQueue = new sqs.Queue(this, 'AuditLogQueue', {
      queueName: `auto-rfp-audit-log-${stage.toLowerCase()}`,
      visibilityTimeout: cdk.Duration.seconds(30),
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: auditLogDlq,
        maxReceiveCount: 3,
      },
    });

    this.auditQueueName = auditLogQueue.queueName;

    // Grant Lambda role send + consume permissions
    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'AuditQueueAccess',
      actions: ['sqs:SendMessage', 'sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'],
      resources: [auditLogQueue.queueArn],
    }));

    const auditQueueUrl = `https://sqs.${cdk.Aws.REGION}.amazonaws.com/${cdk.Aws.ACCOUNT_ID}/${auditLogQueue.queueName}`;

    // ── Lambda: audit-log-writer (SQS consumer) ───────────────────────────────
    const auditLogWriter = new lambdaNodejs.NodejsFunction(this, 'AuditLogWriter', {
      functionName: `auto-rfp-audit-log-writer-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/audit/audit-log-writer.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        AUDIT_LOG_QUEUE_URL: auditQueueUrl,
      },
      bundling,
    });

    new logs.LogGroup(this, 'AuditLogWriterLogs', {
      logGroupName: `/aws/lambda/${auditLogWriter.functionName}`,
      retention: isProd ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    auditLogWriter.addEventSource(
      new lambdaEventSources.SqsEventSource(auditLogQueue, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );

    // ── Lambda: audit-archiver (DynamoDB Streams consumer) ────────────────────
    const auditArchiver = new lambdaNodejs.NodejsFunction(this, 'AuditArchiver', {
      functionName: `auto-rfp-audit-archiver-${stage}`,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/audit/audit-archiver.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        AUDIT_ARCHIVE_BUCKET: auditArchiveBucket.bucketName,
      },
      bundling,
    });

    new logs.LogGroup(this, 'AuditArchiverLogs', {
      logGroupName: `/aws/lambda/${auditArchiver.functionName}`,
      retention: isProd ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Attach DynamoDB Streams as event source — filters to REMOVE events only
    auditArchiver.addEventSource(
      new lambdaEventSources.DynamoEventSource(mainTable as dynamodb.Table, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 100,
        bisectBatchOnError: true,
        retryAttempts: 3,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual('REMOVE'),
          }),
        ],
      }),
    );

    // Grant Lambda role DynamoDB Streams read access
    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      sid: 'DynamoStreamsRead',
      actions: [
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:DescribeStream',
        'dynamodb:ListStreams',
      ],
      resources: [`${mainTable.tableArn}/stream/*`],
    }));

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AuditLogQueueUrl', {
      value: auditQueueUrl,
      description: 'SQS queue URL for audit log events',
    });

    new cdk.CfnOutput(this, 'AuditArchiveBucketName', {
      value: auditArchiveBucket.bucketName,
      description: 'S3 bucket for long-term audit log archival (Glacier)',
    });
  }
}
