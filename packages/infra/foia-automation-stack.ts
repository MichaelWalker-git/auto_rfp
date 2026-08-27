import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as path from 'path';
import { foiaConfigurationSetName } from './foia-naming';

export interface FoiaAutomationStackProps extends cdk.StackProps {
  stage: string;
  mainTable: dynamodb.ITable;
  commonEnv: Record<string, string>;
  /** Documents bucket, read for the solicitation text scan. */
  documentsBucketName: string;
  /**
   * Secrets Manager ARN (or name) holding the api.data.gov key for the FOIA.gov
   * directory seeder.
   *
   * An ARN rather than the key itself: a plain env var would put the credential
   * in the CloudFormation template and expose it to anyone with console read on
   * the Lambda. Optional — the API answers unauthenticated, but only on a shared
   * quota that this seeder has already been rate-limited off once.
   */
  foiaGovApiKeySecretArn?: string;
  /**
   * Verified SES sender for outbound FOIA mail.
   *
   * Required because the reconciler can now send unattended, and the send helper
   * reads it at module load — an unset value crashes the Lambda on import.
   */
  sesFromEmail: string;
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

    const {
      stage,
      mainTable,
      commonEnv,
      documentsBucketName,
      foiaGovApiKeySecretArn,
      sesFromEmail,
    } = props;

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

    /**
     * Read anywhere in the documents bucket: the tier-3 recipient scan reads the
     * already-extracted solicitation text, which lives under the document
     * pipeline's own keys.
     */
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadDocumentsForRecipientScan',
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${documentsBucketName}/*`],
      }),
    );

    /**
     * Write ONLY the FOIA artifact prefix.
     *
     * The grant used to be read-only, with a comment asserting the reconciler
     * "never writes". That stopped being true once preparation began persisting
     * the letter text and .eml: every automated preparation failed with an S3
     * AccessDenied *after* the request row had already been written, leaving a
     * request with no artifacts — recoverable, but only because the write order
     * was chosen for exactly that case.
     *
     * The wildcards mirror `buildFoiaArtifactPrefix`, which composes
     * `{orgId}/{projectId}/{oppId}/foia/{foiaId}/...`. Granting write on the whole
     * bucket would let a bug here overwrite a customer's solicitation documents,
     * which share it — and those are the source records the recipient scan reads,
     * so corrupting them would silently degrade recipient resolution rather than
     * fail loudly. PutObject only: the reconciler has no reason to delete.
     */
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'WriteFoiaArtifactsOnly',
        actions: ['s3:PutObject'],
        resources: [`arn:aws:s3:::${documentsBucketName}/*/*/*/foia/*`],
      }),
    );

    /**
     * Read the audit-log HMAC secret.
     *
     * Required for `writeFoiaSendAuditLog`, which integrity-hashes each entry. This role
     * is built here rather than shared, so it does not inherit the grant that
     * `audit-stack.ts` gives the common role — and without it every audit write on the
     * unattended send path would fail with AccessDenied behind a best-effort `catch`,
     * leaving the exact gap the audit write was added to close, silently.
     *
     * The parameter name is the one `audit-stack.ts` creates and `helpers/secret.ts`
     * reads; scoped to that single parameter rather than a wildcard.
     */
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'ReadAuditHmacSecret',
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/auto-rfp/audit-hmac-secret-${stage.toLowerCase()}`,
        ],
      }),
    );

    /**
     * Send outbound FOIA mail.
     *
     * The reconciler transmits requests whose recipient came from a trusted source
     * in an org that opted in, so it needs the same SES grant as the approval
     * handler. Scoped to identities and configuration sets in this account —
     * `SendRawEmail` is required because the letter goes out as MIME with the PDF
     * attached, and the configuration set is what routes bounces back, without
     * which a rejected statutory request looks delivered.
     */
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        sid: 'SESFoiaAutoSend',
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:aws:ses:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:identity/*`,
          `arn:aws:ses:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:configuration-set/*`,
        ],
      }),
    );

    /**
     * Read the api.data.gov key from the secret store.
     *
     * Scoped to this one secret rather than a prefix wildcard: the seeder needs
     * exactly one credential, so a broader grant would let any future bug in a
     * Lambda on this shared role reach unrelated secrets.
     */
    if (foiaGovApiKeySecretArn) {
      lambdaRole.addToPolicy(
        new iam.PolicyStatement({
          sid: 'ReadFoiaGovApiKey',
          actions: ['secretsmanager:GetSecretValue'],
          // A 6-character suffix is appended to the ARN on creation, so a
          // name-derived ARN must tolerate the trailing characters.
          resources: [`${foiaGovApiKeySecretArn}*`],
        }),
      );
    }

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
        /**
         * Required, not optional: the reconciler now transmits auto-send-eligible
         * requests itself, and `helpers/foia-send` reads this at MODULE LOAD. An
         * unset value throws during import, which would crash the Lambda on cold
         * start before any reconciliation happened — taking down Level 2 entirely,
         * not just the send.
         */
        SES_FROM_EMAIL: sesFromEmail,
        /**
         * FOIA_SES_CONFIGURATION_SET is set below, from the construct itself —
         * see `scanLambda.addEnvironment`.
         *
         * There used to be a prop for it, passed in from `bin/`. That prop and the
         * construct derived the same name independently and drifted on casing
         * ("auto-rfp-foia-dev" vs "auto-rfp-foia-Dev"). SES configuration-set names
         * are case-sensitive, so `SendRawEmail` was rejected outright — every
         * unattended send would have failed while the human-approved path kept
         * working, which is the hardest kind of failure to notice. The prop is gone;
         * reading the created resource's own name makes the drift unreproducible.
         */
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

    // ── 6. FOIA.gov directory seeder ────────────────────────────────────────
    //
    // Mirrors the published agency-component directory so the reconciler never
    // calls an external API to choose a legal recipient. Monthly is ample: FOIA
    // office addresses change on the order of years.
    const seedFunctionName = `auto-rfp-foia-seed-components-${stage}`;

    const seedLogGroup = new logs.LogGroup(this, 'FoiaSeedLogGroup', {
      logGroupName: `/aws/lambda/${seedFunctionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const seedLambda = new lambdaNodejs.NodejsFunction(this, 'FoiaSeedComponentsFn', {
      functionName: seedFunctionName,
      entry: path.join(
        __dirname,
        '../../apps/functions/src/handlers/foia/seed-foia-components.ts',
      ),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      // ~614 components across 13 pages, each written with its two pointer rows.
      timeout: cdk.Duration.minutes(10),
      memorySize: 512,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        // Optional: the seeder falls back to the shared public quota when unset.
        ...(foiaGovApiKeySecretArn
          ? { FOIA_GOV_API_KEY_SECRET_ARN: foiaGovApiKeySecretArn }
          : {}),
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });

    seedLambda.node.addDependency(seedLogGroup);

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${seedFunctionName}:*`,
        ],
      }),
    );

    const seedRule = new events.Rule(this, 'FoiaSeedRule', {
      ruleName: seedFunctionName,
      description: 'Monthly refresh of the FOIA.gov agency-component directory',
      // 04:00 UTC on the 1st — well clear of the daily 09:00 reconciler.
      schedule: events.Schedule.cron({ minute: '0', hour: '4', day: '1' }),
    });

    seedRule.addTarget(
      new targets.LambdaFunction(seedLambda, {
        event: events.RuleTargetInput.fromObject({ detail: { dryRun: false } }),
        retryAttempts: 1,
      }),
    );

    // ── 7. SES configuration set + bounce handling ──────────────────────────
    //
    // A dedicated set rather than the pre-existing `emails_sending`: that one is
    // not the identity default and no code names it, so it carries no traffic —
    // attaching destinations there would monitor nothing. This one is owned by
    // CDK, so Dev/Test/prod get it identically.
    //
    // Bounce handling is what gates unattended sending. Without it a rejected
    // statutory request is indistinguishable from a delivered one, and the FOIA
    // deadline passes while the record says SENT.
    const configurationSet = new ses.ConfigurationSet(this, 'FoiaConfigurationSet', {
      configurationSetName: foiaConfigurationSetName(stage),
      // Legal correspondence should not fall back to cleartext.
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE,
      reputationMetrics: true,
    });

    /**
     * Wire the created set's real name into the reconciler.
     *
     * Done here rather than in the environment block above because the construct
     * does not exist yet at that point. Using `configurationSet.configurationSetName`
     * rather than re-deriving the string is the point: the two derivations had
     * already drifted on casing, and SES rejects a mismatched name outright.
     */
    scanLambda.addEnvironment(
      'FOIA_SES_CONFIGURATION_SET',
      configurationSet.configurationSetName,
    );

    const bounceTopic = new sns.Topic(this, 'FoiaBounceTopic', {
      topicName: `auto-rfp-foia-bounces-${stage}`,
      displayName: 'AutoRFP FOIA bounces and complaints',
    });

    // Reject cleartext publishes (AwsSolutions-SNS3). A DENY with AnyPrincipal is
    // the AWS-recommended pattern for forcing TLS, mirroring
    // stale-content-detection-stack.ts.
    bounceTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'EnforceSSL',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [bounceTopic.topicArn],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );

    configurationSet.addEventDestination('FoiaBounceEvents', {
      destination: ses.EventDestination.snsTopic(bounceTopic),
      events: [
        ses.EmailSendingEvent.BOUNCE,
        ses.EmailSendingEvent.COMPLAINT,
        ses.EmailSendingEvent.REJECT,
        // DELIVERY closes the loop: "accepted by SES" is not "reached the agency".
        ses.EmailSendingEvent.DELIVERY,
      ],
    });

    const bounceFunctionName = `auto-rfp-foia-ses-events-${stage}`;

    const bounceLogGroup = new logs.LogGroup(this, 'FoiaSesEventsLogGroup', {
      logGroupName: `/aws/lambda/${bounceFunctionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [
          `arn:aws:logs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:log-group:/aws/lambda/${bounceFunctionName}:*`,
        ],
      }),
    );

    const bounceLambda = new lambdaNodejs.NodejsFunction(this, 'FoiaSesEventsFn', {
      functionName: bounceFunctionName,
      entry: path.join(__dirname, '../../apps/functions/src/handlers/foia/on-ses-event.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      role: lambdaRole,
      environment: { ...commonEnv },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });

    bounceLambda.node.addDependency(bounceLogGroup);
    bounceTopic.addSubscription(new snsSubscriptions.LambdaSubscription(bounceLambda));

    // Route Lambdas send FOIA mail, so they need the set name to reference it.
    // Exported rather than injected: the API stack builds its own env.
    new cdk.CfnOutput(this, 'FoiaSesConfigurationSetName', {
      value: configurationSet.configurationSetName,
      description: 'SES configuration set FOIA sends must name, so bounces are captured',
      exportName: `AutoRfp-FoiaSesConfigSet-${stage}`,
    });

    // 8. Outputs.
    new cdk.CfnOutput(this, 'FoiaScanLambdaArn', {
      value: scanLambda.functionArn,
      description: 'Lambda ARN for the daily FOIA automation reconciler',
    });

    new cdk.CfnOutput(this, 'FoiaSeedLambdaArn', {
      value: seedLambda.functionArn,
      description: 'Lambda ARN for the monthly FOIA.gov directory seeder',
    });
  }
}
