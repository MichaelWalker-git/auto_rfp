import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sesActions from 'aws-cdk-lib/aws-ses-actions';
import * as path from 'path';
import { NagSuppressions } from 'cdk-nag';

export interface FoiaInboundStackProps extends cdk.StackProps {
  stage: string;
  /** Name of the shared single table, which lives in the primary region. */
  mainTableName: string;
  /** Account-and-region-qualified ARN of the shared table. */
  mainTableArn: string;
  /** Primary region, where the table and documents bucket live. */
  primaryRegion: string;
  commonEnv: Record<string, string>;
  /**
   * Subdomain that receives FOIA mail, e.g. `inbox.horustech.dev`.
   *
   * A dedicated subdomain, never the apex: the apex MX belongs to Google Workspace
   * and pointing it at SES would silently destroy all company email.
   */
  receiptDomain: string;
  /** Local part of the receiving address, e.g. `foia`. */
  receiptLocalPart: string;
}

/**
 * Level 1: receives forwarded procurement mail so award notices and
 * cancellations can move a FOIA schedule.
 *
 * ## Why this is a separate stack, in a non-primary region
 *
 * SES allows exactly **one active receipt rule set per region**, and us-east-1's
 * already belongs to another project (`emails_receiving`, for
 * grandmascookies.link) which is not defined in this repo. Appending to it would
 * mean CDK managing a resource it does not own, and recreating it would mean
 * taking over another project's live mail path.
 *
 * Only three regions support SES inbound at all — us-east-1, us-west-2,
 * eu-west-1 — and the latter two are empty. So this stack owns a rule set
 * outright in a region where nothing else receives, with no blast radius and a
 * clean teardown. The region is invisible to senders: mail routing is decided by
 * the MX record, not by where the rule set happens to live.
 *
 * ## Cross-region
 *
 * The raw message stays in this region's bucket; only small metadata writes cross
 * to the primary region's table. That keeps transfer costs at zero and means a
 * regional outage here cannot corrupt the primary data.
 *
 * ## DNS is deliberately not managed here
 *
 * The MX record is left to a reviewed manual step. `horustech.dev` carries live
 * company email on its apex, and a CDK-managed record set on the same hosted zone
 * is one bad diff away from a mail outage that has nothing to do with FOIA. The
 * required record is emitted as an output instead.
 */
export class FoiaInboundStack extends cdk.Stack {
  /** MX record value the receiving subdomain must publish. */
  public readonly requiredMxRecord: string;

  constructor(scope: Construct, id: string, props: FoiaInboundStackProps) {
    super(scope, id, props);

    const {
      stage,
      mainTableName,
      mainTableArn,
      primaryRegion,
      commonEnv,
      receiptDomain,
      receiptLocalPart,
    } = props;

    const functionName = `auto-rfp-foia-inbound-${stage}`;
    const recipient = `${receiptLocalPart}@${receiptDomain}`;
    // S3 bucket names must be lowercase, and `stage` is capitalized ("Dev").
    // Interpolating it directly fails at CREATE time, not at synth.
    const stageSlug = stage.toLowerCase();

    // ─── 1. Encryption key ────────────────────────────────────────────────────
    //
    // Customer-managed rather than an AWS-owned key: these messages are a
    // customer's procurement correspondence, and key rotation and access policy
    // need to be auditable independently of the bucket.
    const mailKey = new kms.Key(this, 'FoiaInboundKey', {
      description: `Encrypts inbound FOIA mail (${stage})`,
      enableKeyRotation: true,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // SES writes the object, so it needs to encrypt under this key.
    mailKey.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSesToEncrypt',
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['kms:GenerateDataKey', 'kms:Encrypt'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'aws:SourceAccount': cdk.Aws.ACCOUNT_ID },
        },
      }),
    );

    // ─── 2. Raw message bucket ────────────────────────────────────────────────
    //
    // Access logs go to a separate bucket. This is not a formality: the mail
    // bucket holds a customer's procurement correspondence, so who read which
    // message is itself auditable information. Logging into the same bucket would
    // put the audit trail under the same delete permission as the thing it audits.
    const accessLogBucket = new s3.Bucket(this, 'FoiaInboundAccessLogs', {
      bucketName: `auto-rfp-foia-inbound-logs-${stageSlug}-${cdk.Aws.ACCOUNT_ID}`,
      // S3 server access logging cannot write to a KMS-CMK-encrypted bucket, so
      // this uses SSE-S3. The logs contain object keys and requester identity, not
      // message content.
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ id: 'expire-access-logs', expiration: cdk.Duration.days(365) }],
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'prod',
    });

    cdk.Tags.of(accessLogBucket).add('data-classification', 'internal');

    const mailBucket = new s3.Bucket(this, 'FoiaInboundBucket', {
      serverAccessLogsBucket: accessLogBucket,
      serverAccessLogsPrefix: 'mail-bucket-access/',
      bucketName: `auto-rfp-foia-inbound-${stageSlug}-${cdk.Aws.ACCOUNT_ID}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: mailKey,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [
        {
          // The decision and any attached documents are persisted elsewhere; this
          // is the raw evidence copy. Keeping it indefinitely would accumulate a
          // customer's correspondence with no expiry for no operational benefit.
          id: 'expire-raw-mail',
          expiration: cdk.Duration.days(stage === 'prod' ? 365 : 90),
        },
      ],
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'prod',
    });

    cdk.Tags.of(mailBucket).add('data-classification', 'confidential');

    // SES needs explicit permission to put the received message.
    mailBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowSesPut',
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        actions: ['s3:PutObject'],
        resources: [mailBucket.arnForObjects('*')],
        conditions: {
          StringEquals: { 'aws:Referer': cdk.Aws.ACCOUNT_ID },
        },
      }),
    );

    // ─── 3. Execution role ────────────────────────────────────────────────────
    const lambdaRole = new iam.Role(this, 'FoiaInboundLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${functionName}:*`,
        ],
      }),
    );

    // Read the raw message this stack's own bucket received. Read-only: ingestion
    // never mutates the evidence copy.
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [mailBucket.arnForObjects('*')],
      }),
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [mailKey.keyArn],
      }),
    );

    // The shared table lives in the primary region; the ARN is qualified, so this
    // grant is explicit about crossing regions.
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:Query',
        ],
        resources: [mainTableArn, `${mainTableArn}/index/*`],
      }),
    );

    // ─── 4. Ingestion Lambda ──────────────────────────────────────────────────
    const logGroup = new logs.LogGroup(this, 'FoiaInboundLogGroup', {
      logGroupName: `/aws/lambda/${functionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const inboundLambda = new lambdaNodejs.NodejsFunction(this, 'FoiaInboundFn', {
      functionName,
      entry: path.join(
        __dirname,
        '../../apps/functions/src/handlers/foia/process-inbound-mail.ts',
      ),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      // One message per invocation; the work is a parse, a classify and a few
      // small writes. Generous only to absorb a large multipart attachment set.
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        DB_TABLE_NAME: mainTableName,
        // Overrides commonEnv.REGION: the SDK must talk to the table's region,
        // not the region this Lambda happens to run in.
        REGION: primaryRegion,
        FOIA_INBOUND_BUCKET: mailBucket.bucketName,
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });

    inboundLambda.node.addDependency(logGroup);

    // ─── 5. Receipt rule set ──────────────────────────────────────────────────
    //
    // Store-then-notify, in that order within a single rule. The S3 action runs
    // first so the raw message is durable before the Lambda is told about it —
    // otherwise a Lambda failure could lose a message SES has already accepted.
    const ruleSet = new ses.ReceiptRuleSet(this, 'FoiaInboundRuleSet', {
      receiptRuleSetName: `auto-rfp-foia-inbound-${stage}`,
      rules: [
        {
          receiptRuleName: `foia-inbound-${stage}`,
          // Scoped to the single receiving address. A domain-wide rule would
          // accept mail for any local part and pull unrelated traffic into the
          // classifier.
          recipients: [recipient],
          enabled: true,
          scanEnabled: true,
          // Reject anything not delivered over TLS.
          tlsPolicy: ses.TlsPolicy.REQUIRE,
          actions: [
            new sesActions.S3({
              bucket: mailBucket,
              objectKeyPrefix: 'inbound/',
              kmsKey: mailKey,
            }),
            new sesActions.Lambda({
              function: inboundLambda,
              invocationType: sesActions.LambdaInvocationType.EVENT,
            }),
          ],
        },
      ],
    });

    this.requiredMxRecord = `10 inbound-smtp.${cdk.Aws.REGION}.amazonaws.com`;

    // ─── 6. Outputs — the manual steps, stated explicitly ─────────────────────
    new cdk.CfnOutput(this, 'ReceiptRuleSetName', {
      value: ruleSet.receiptRuleSetName,
      description:
        'Must be ACTIVATED manually (aws ses set-active-receipt-rule-set). CDK cannot ' +
        'activate a rule set, and activation is what starts accepting mail.',
    });

    new cdk.CfnOutput(this, 'RequiredMxRecord', {
      value: `${receiptDomain} MX ${this.requiredMxRecord}`,
      description:
        'Add to the hosted zone by hand after reviewing the diff. Never touch the ' +
        'apex MX — it carries live company email via Google Workspace.',
    });

    new cdk.CfnOutput(this, 'RequiredDomainIdentity', {
      value: receiptDomain,
      // Descriptions must be literal strings — interpolating cdk.Aws.REGION
      // produces an Fn::Join, which CloudFormation rejects with "Every
      // Description member must be a string". The region is in the stack's own
      // metadata anyway, so it does not need repeating here.
      description:
        'Verify this domain in SES in THIS stack region. Identities are per-region, ' +
        'so verification in the primary region does not carry over.',
    });

    new cdk.CfnOutput(this, 'ReceivingAddress', {
      value: recipient,
      description:
        'Forward the monitored Google Group here — only AFTER the rule set is active ' +
        'and the domain is verified, or group mail will bounce.',
    });

    new cdk.CfnOutput(this, 'InboundBucketName', {
      value: mailBucket.bucketName,
      description: 'Bucket holding the raw received messages.',
    });

    // ─── 7. cdk-nag ───────────────────────────────────────────────────────────
    //
    // Scoped to the specific paths and ARNs rather than suppressed stack-wide, so
    // a future wildcard added somewhere else still fails the check.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/FoiaInboundLambdaRole/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason:
            'Object-level and log-stream-level wildcards are the narrowest form these ' +
            'grants can take: S3 object keys are assigned by SES per message, log stream ' +
            'names by Lambda per invocation, and DynamoDB index names are not knowable ' +
            'from a cross-region stack. All three are scoped to a single named resource.',
          // cdk-nag reports the UNRESOLVED form, so `${cdk.Aws.REGION}` must appear
          // here as the literal `<AWS::Region>` placeholder rather than a token —
          // an interpolated token produces a string that never matches the finding.
          appliesTo: [
            'Resource::arn:aws:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/lambda/' +
              `${functionName}:*`,
            'Resource::<FoiaInboundBucketB79EC482.Arn>/*',
            `Resource::${mainTableArn}/index/*`,
          ],
        },
      ],
    );

    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/FoiaInboundFn/Resource`,
      [
        {
          id: 'AwsSolutions-L1',
          reason:
            'NODEJS_22_X is the newest runtime CDK exposes here and matches every other ' +
            'Lambda in this repo. Diverging would fragment the runtime matrix for no gain.',
        },
      ],
    );

    // The access-log bucket cannot itself log to a bucket (S3 refuses the cycle),
    // and it holds no message content — only object keys and requester identity.
    NagSuppressions.addResourceSuppressionsByPath(
      this,
      `/${this.stackName}/FoiaInboundAccessLogs/Resource`,
      [
        {
          id: 'AwsSolutions-S1',
          reason:
            'This IS the access-log destination. S3 does not permit a log bucket to log ' +
            'to itself, and a second tier of logs auditing the audit trail has no reader.',
        },
      ],
    );
  }
}
