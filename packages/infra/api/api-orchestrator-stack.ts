import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
// apigwv2Integrations used in nested stacks only
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';

import { ApiSharedInfraStack } from './api-shared-infra-stack';
import { ApiDomainLambdaStack } from './api-domain-lambda-stack';
import type { DomainRoutes } from './routes/types';
import { foiaDomain } from './routes/foia.routes';
import { debriefingDomain } from './routes/debriefing.routes';
import { answerDomain } from './routes/answer.routes';
import { organizationDomain } from './routes/organization.routes';
import { presignedDomain } from './routes/presigned.routes';
import { knowledgebaseDomain } from './routes/knowledgebase.routes';
import { documentDomain } from './routes/document.routes';
import { questionfileDomain } from './routes/questionfile.routes';
import { userDomain } from './routes/user.routes';
import { questionDomain } from './routes/question.routes';
import { semanticDomain } from './routes/semantic.routes';
import { deadlinesDomain } from './routes/deadlines.routes';
import { opportunityDomain } from './routes/opportunity.routes';
import { contentlibraryDomain } from './routes/content-library.routes';
import { projectsDomain } from './routes/projects.routes';
import { promptDomain } from './routes/prompt.routes';
import { searchOpportunityDomain } from './routes/search-opportunity.routes';
import { linearRoutes } from './routes/linear.routes';
import { briefDomain } from './routes/brief.routes';
import { pastperfDomain } from './routes/pastperf.routes';
import { rfpDocumentDomain } from './routes/rfp-document.routes';
import { templateDomain } from './routes/template.routes';
import { googleDomain } from './routes/google.routes';
import { clusteringDomain } from './routes/clustering.routes';
import { collaborationDomain } from './routes/collaboration.routes';
import { opportunityContextDomain } from './routes/opportunity-context.routes';
import { notificationDomain } from './routes/notification.routes';
import { auditDomain } from './routes/audit.routes';
import { analyticsDomain } from './routes/analytics.routes';
import { clarifyingQuestionDomain } from './routes/clarifying-question.routes';
import { engagementLogDomain } from './routes/engagement-log.routes';
import { apnDomain } from './routes/apn.routes';
import { proposalSubmissionDomain } from './routes/proposal-submission.routes';
import { documentApprovalDomain } from './routes/document-approval.routes';
import { universalApprovalDomain } from './routes/universal-approval.routes';
import { pricingDomain } from './routes/pricing.routes';
import { extractionDomain } from './routes/extraction.routes';
import { opportunityAssistantDomain } from './routes/opportunity-assistant.routes';
import { complianceReviewDomain } from './routes/compliance-review.routes';
import { packageEditDomain } from './routes/package-edit.routes';
import { questionnaireDomain } from './routes/questionnaire.routes';
import { companyProfileDomain } from './routes/company-profile.routes';
import { requiredFormsDomain } from './routes/required-forms.routes';
import { dashboardDomain } from './routes/dashboard.routes';
import { solutionPlanDomain } from './routes/solution-plan.routes';
import { relatedRfpDomain } from './routes/related-rfp.routes';
import { employeeDomain } from './routes/employee.routes';
import { foiaConfigurationSetName } from '../foia-naming';

export interface ApiOrchestratorStackProps extends cdk.StackProps {
  stage: string;
  userPool: cognito.IUserPool;
  userPoolClientId: string;
  mainTable: dynamodb.ITable;
  documentsBucket: s3.IBucket;
  execBriefQueue?: sqs.IQueue;
  googleDriveSyncQueue?: sqs.IQueue;
  documentGenerationQueue?: sqs.IQueue;
  clarifyingQuestionQueue?: sqs.IQueue;
  extractionQueue?: sqs.IQueue;
  notificationQueueName?: string;
  auditLogQueueName?: string;
  documentPipelineStateMachineArn: string;
  questionPipelineStateMachineArn: string;
  answerGenerationStateMachineArn: string;
  textractFormsTopicArn: string;
  textractFormsRoleArn: string;
  sentryDNS: string;
  pineconeApiKey: string;
  /**
   * Public URL of the frontend app, used to build deep links back into AutoRFP
   * from external integrations (e.g. the opportunity link in Linear tickets).
   */
  frontendUrl?: string;
  /**
   * Server-side allowlist for the RFP-tracking dashboard. When set, the
   * get-rfp-pipeline Lambda rejects any orgId that does not match this value
   * (closes the client-only gate / IDOR gap). Empty string = gate disabled
   * (stages without a designated RFP org fall back to prior behavior).
   */
  rfpTrackingOrgId?: string;
}

/**
 * Orchestrates all API infrastructure:
 * 1. Creates the REST API directly in this stack
 * 2. Sets up shared Lambda infrastructure
 * 3. Instantiates domain-specific route nested stacks
 * 
 * Routes are added via NestedStacks to manage CloudFormation resource limits.
 * The API is created in the parent stack to avoid cyclic dependencies.
 */
export class ApiOrchestratorStack extends cdk.Stack {
  public readonly commonLambdaRoleArn: string;
  public readonly httpApi: apigwv2.HttpApi;
  public readonly apiUrl: string;

  // Keep legacy fields for backward compatibility during migration
  public readonly restApiId: string;
  public readonly rootResourceId: string;
  public readonly api: apigateway.RestApi | undefined;

  constructor(scope: Construct, id: string, props: ApiOrchestratorStackProps) {
    super(scope, id, props);

    const {
      stage,
      userPool,
      userPoolClientId,
      mainTable,
      documentsBucket,
      execBriefQueue,
      googleDriveSyncQueue,
      documentGenerationQueue,
      notificationQueueName,
      auditLogQueueName,
      documentPipelineStateMachineArn,
      questionPipelineStateMachineArn,
      answerGenerationStateMachineArn,
      textractFormsTopicArn,
      textractFormsRoleArn,
      sentryDNS,
      pineconeApiKey,
      rfpTrackingOrgId,
    } = props;

    // ── Keep old REST API alive temporarily to preserve CloudFormation exports ──
    // AmplifyFeStack imports the old ApiStage export. Once it updates to use
    // the new HTTP API URL, remove this block and deploy again.
    // TODO: Remove after AmplifyFeStack migration
    this.api = new apigateway.RestApi(this, 'AutoRfpApi', {
      restApiName: `AutoRFP API Legacy (${stage})`,
      deploy: false,
    });
    // Add a dummy method so CloudFormation doesn't reject the empty API
    this.api.root.addMethod('GET', new apigateway.MockIntegration({
      integrationResponses: [{ statusCode: '200' }],
      requestTemplates: { 'application/json': '{"statusCode": 200}' },
    }), { methodResponses: [{ statusCode: '200' }] });
    const legacyDeployment = new apigateway.Deployment(this, 'ApiDeployment', { api: this.api });
    new apigateway.Stage(this, 'ApiStage', { deployment: legacyDeployment, stageName: `${stage}legacy` });
    this.restApiId = this.api.restApiId;
    this.rootResourceId = this.api.restApiRootResourceId;

    // 1. Create HTTP API (v2) — no resource limit, cheaper, lower latency
    this.httpApi = new apigwv2.HttpApi(this, 'AutoRfpHttpApi', {
      apiName: `AutoRFP API (${stage})`,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigwv2.CorsHttpMethod.ANY],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Org-Id',
        ],
        allowCredentials: false, // Cannot be true with allowOrigins: ['*']
        maxAge: cdk.Duration.hours(1),
      },
      createDefaultStage: false,
    });

    // apiUrl points to the NEW HTTP API (not the legacy REST API)

    // JWT authorizer using Cognito User Pool
    const region = cdk.Aws.REGION;
    const jwtAuthorizer = new apigwv2Authorizers.HttpJwtAuthorizer(
      'CognitoJwtAuthorizer',
      `https://cognito-idp.${region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClientId],
      },
    );

    // 2. Create shared infrastructure (Lambda role + common env)
    // ─── Compliance Review queue (async full-package review) ──────────────
    // Owned by this stack (self-contained) rather than threaded through props.
    const complianceReviewDlq = new sqs.Queue(this, `ComplianceReviewDLQ-${stage}`, {
      queueName: `auto-rfp-compliance-review-dlq-${stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });
    const complianceReviewQueue = new sqs.Queue(this, `ComplianceReviewQueue-${stage}`, {
      queueName: `auto-rfp-compliance-review-${stage}`,
      // Must be >= the worker Lambda timeout so a message isn't redelivered mid-run.
      visibilityTimeout: cdk.Duration.minutes(16),
      // A full review is a long, expensive Sonnet job. If it fails, don't burn
      // ~15 min of model time retrying twice more — one attempt, then DLQ. The
      // run is marked FAILED by the worker/stale-recovery so the user can re-run.
      deadLetterQueue: { queue: complianceReviewDlq, maxReceiveCount: 1 },
    });

    // ─── Solution Plan queue (async grilling loop, step-per-round) ────────
    // Owned by this stack (self-contained), like the compliance review queue.
    const solutionPlanDlq = new sqs.Queue(this, `SolutionPlanDLQ-${stage}`, {
      queueName: `auto-rfp-solution-plan-dlq-${stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });
    const solutionPlanQueue = new sqs.Queue(this, `SolutionPlanQueue-${stage}`, {
      queueName: `auto-rfp-solution-plan-${stage}`,
      // Must be >= the worker Lambda timeout so a message isn't redelivered mid-run.
      visibilityTimeout: cdk.Duration.minutes(16),
      // One grilling round is an expensive model job and the worker marks the
      // plan FAILED on error — one attempt, then DLQ. The user retries via re-init.
      deadLetterQueue: { queue: solutionPlanDlq, maxReceiveCount: 1 },
    });

    // ─── Package Edit queue (async cross-package "Mass Edit" proposal scan) ────
    // Clone of the compliance-review queue: the proposal scan is a long Sonnet job
    // that can't fit in the 29s chat turn, so the chat handler enqueues it here and
    // the PackageEditWorker drafts the proposals asynchronously.
    const packageEditDlq = new sqs.Queue(this, `PackageEditDLQ-${stage}`, {
      queueName: `auto-rfp-package-edit-dlq-${stage}`,
      retentionPeriod: cdk.Duration.days(14),
    });
    const packageEditQueue = new sqs.Queue(this, `PackageEditQueue-${stage}`, {
      queueName: `auto-rfp-package-edit-${stage}`,
      // Must be >= the worker Lambda timeout so a message isn't redelivered mid-scan.
      visibilityTimeout: cdk.Duration.minutes(16),
      // Long, expensive Sonnet scan — one attempt then DLQ (don't burn ~15 min
      // retrying a doomed run). The run is marked FAILED by the worker/stale-recovery.
      deadLetterQueue: { queue: packageEditDlq, maxReceiveCount: 1 },
    });

    const commonEnv: Record<string, string> = {
      STAGE: stage,
      // Solution Plan grilling loop — REST init enqueues, the worker re-enqueues each round.
      SOLUTION_PLAN_QUEUE_URL: solutionPlanQueue.queueUrl,
      // Solution Plan generation gate kill switch (T9) — deploy with
      // SOLUTION_PLAN_GATING=off to disable the gate stage-wide.
      SOLUTION_PLAN_GATING: process.env.SOLUTION_PLAN_GATING || 'on',
      // KB coverage precheck kill switch — deploy with KB_COVERAGE_GATING=off to
      // disable stage-wide. Safe to default 'on': blocking additionally requires
      // the per-org `enableKBCoverageGate` flag, which defaults off.
      KB_COVERAGE_GATING: process.env.KB_COVERAGE_GATING || 'on',
      // AI compliance review — fast model for sync chat, stronger model for the async worker.
      COMPLIANCE_REVIEW_CHAT_MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      COMPLIANCE_REVIEW_WORKER_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
      COMPLIANCE_REVIEW_QUEUE_URL: complianceReviewQueue.queueUrl,
      // Cross-package AI editing ("Mass Edit") — Haiku routes the chat turn, Sonnet
      // scans in the async worker.
      PACKAGE_EDIT_CHAT_MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      PACKAGE_EDIT_WORKER_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
      PACKAGE_EDIT_QUEUE_URL: packageEditQueue.queueUrl,
      AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      NODE_ENV: 'production',
      DB_TABLE_NAME: mainTable.tableName,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      DEFAULT_TEMP_PASSWORD: process.env.DEFAULT_TEMP_PASSWORD || 'Welcome1!',
      REGION: 'us-east-1',
      BEDROCK_REGION: 'us-east-1',
      BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
      BEDROCK_MODEL_ID: 'us.anthropic.claude-opus-4-6-v1',
      // Web-search provider for the search_service_pricing tool (T3/T15).
      // 'tavily' (default) or 'brave' — deploy with WEB_SEARCH_PROVIDER=brave on a
      // stage that should keep using an existing Brave key. API keys are created
      // manually per stage in SSM (see docs/improvements_v1/
      // RUNBOOK-WEB-SEARCH-API-KEY.md); commonLambdaRole's ssm:GetParameter
      // grant on /auto-rfp/* already covers both parameters.
      WEB_SEARCH_PROVIDER: process.env.WEB_SEARCH_PROVIDER || 'tavily',
      TAVILY_API_KEY_SSM_PARAM: '/auto-rfp/tavily/api-key',
      BRAVE_SEARCH_API_KEY_SSM_PARAM: '/auto-rfp/brave-search/api-key',
      STATE_MACHINE_ARN: documentPipelineStateMachineArn,
      QUESTION_PIPELINE_STATE_MACHINE_ARN: questionPipelineStateMachineArn,
      ANSWER_GENERATION_STATE_MACHINE_ARN: answerGenerationStateMachineArn,
      TEXTRACT_FORMS_SNS_TOPIC_ARN: textractFormsTopicArn,
      TEXTRACT_FORMS_ROLE_ARN: textractFormsRoleArn,
      SENTRY_DSN: sentryDNS,
      SENTRY_ENVIRONMENT: stage,
      PINECONE_API_KEY: pineconeApiKey,
      PINECONE_INDEX: 'documents',
      SAM_OPPS_BASE_URL: 'https://api.sam.gov',
      DIBBS_BASE_URL: 'https://www.dibbs.bsm.dla.mil',
      HIGHERGOV_BASE_URL: 'https://www.highergov.com/api-external',
      // Linear org id whose Secrets Manager entry (linear-api-key-<id>) holds the
      // key used to write RFP-tracking approval decisions back onto the Linear board.
      RFP_SYNC_LINEAR_ORG_ID: '6fbf749f-7173-489c-be0a-564f97ebf8b0',
      // Server-side allowlist for the RFP-tracking dashboard (get-rfp-pipeline).
      // Mirrors the per-stage rfpTrackingOrgId used for the frontend feature gate,
      // but enforced in the Lambda so a caller cannot bypass the client check by
      // passing ?orgId=<other org>. Empty when the stage has no designated RFP org.
      ...(rfpTrackingOrgId ? { RFP_TRACKING_ORG_ID: rfpTrackingOrgId } : {}),
      // Verified SES sender identity — horustech.dev domain must be verified in SES
      SES_FROM_EMAIL: 'noreply@horustech.dev',
      // SES configuration set owned by FoiaAutomationStack. Naming it on a send
      // is what routes bounces and complaints to the handler; without it a
      // rejected FOIA request looks identical to a delivered one. Referenced by
      // name rather than imported to avoid a cross-stack dependency cycle (that
      // stack already depends on the database and storage stacks).
      // Derived by the shared helper, not spelled here. The two derivations drifted on
      // casing once; SES config-set names are case-sensitive, so the mismatch rejected
      // every send on one path while the other kept working.
      FOIA_SES_CONFIGURATION_SET: foiaConfigurationSetName(stage),
      // Construct the notification queue URL from the queue name — no cross-stack token reference
      ...(notificationQueueName ? {
        NOTIFICATION_QUEUE_URL: `https://sqs.${cdk.Aws.REGION}.amazonaws.com/${cdk.Aws.ACCOUNT_ID}/${notificationQueueName}`,
      } : {}),
      // Audit log queue URL — allows REST Lambda handlers to enqueue audit events
      ...(auditLogQueueName ? {
        AUDIT_LOG_QUEUE_URL: `https://sqs.${cdk.Aws.REGION}.amazonaws.com/${cdk.Aws.ACCOUNT_ID}/${auditLogQueueName}`,
      } : {}),
    };

    const sharedInfraStack = new ApiSharedInfraStack(this, 'SharedInfra', {
      stage,
      commonEnv,
    });

    this.commonLambdaRoleArn = sharedInfraStack.commonLambdaRole.roleArn;

    // Grant Lambda role access to resources
    mainTable.grantReadWriteData(sharedInfraStack.commonLambdaRole);
    documentsBucket.grantReadWrite(sharedInfraStack.commonLambdaRole);

    // Grant comprehensive Bedrock permissions for all foundation models
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'BedrockModelAccess',
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
          'bedrock:GetFoundationModel',
          'bedrock:ListFoundationModels',
        ],
        resources: [
          `arn:aws:bedrock:${cdk.Aws.REGION}::foundation-model/*`,
          `arn:aws:bedrock:us-east-1::foundation-model/*`,
          `arn:aws:bedrock:us-west-2::foundation-model/*`,
        ],
      }),
    );

    // Allow REST handlers (reprocess-form) to start Textract FORMS analysis using the
    // pipeline-owned Textract service role.
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['textract:StartDocumentAnalysis'],
        resources: ['*'],
      }),
    );
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [textractFormsRoleArn],
      }),
    );

    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminGetUser',
          'cognito-idp:AdminInitiateAuth',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:ListUsers',
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    // Build execution ARNs using CDK's Arn utility
    const docPipelineExecutionArn = cdk.Arn.format({
      service: 'states',
      resource: 'execution',
      resourceName: `AutoRfp-${stage}-DocumentPipeline:*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    }, this);

    const questionPipelineExecutionArn = cdk.Arn.format({
      service: 'states',
      resource: 'execution',
      resourceName: `AutoRfp-${stage}-Question-Pipeline:*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    }, this);

    // Answer-generation state machine is named `AutoRfp-${stage}-AnswerGen-Pipeline`
    // (see packages/infra/answer-generation-step-function.ts). The status endpoint
    // calls ListExecutions on it.
    const answerGenExecutionArn = cdk.Arn.format({
      service: 'states',
      resource: 'execution',
      resourceName: `AutoRfp-${stage}-AnswerGen-Pipeline:*`,
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    }, this);

    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'StepFunctionsExecutionControl2',
        actions: [
          'states:StartExecution',
          'states:StopExecution',
          'states:DescribeExecution',
          'states:ListExecutions',
        ],
        resources: [
          documentPipelineStateMachineArn,
          questionPipelineStateMachineArn,
          answerGenerationStateMachineArn,
          docPipelineExecutionArn,
          questionPipelineExecutionArn,
          answerGenExecutionArn,
        ],
      }),
    );

    // Grant Lambda role access to Secrets Manager for SAM.gov API keys
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:DeleteSecret',
          'secretsmanager:CreateSecret',
          'secretsmanager:RestoreSecret',
        ],
        resources: [`arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:*-api-key-*`],
      }),
    );

    // Grant notification queue send permission to all REST Lambda handlers.
    // Use a name-pattern ARN to avoid a cross-stack reference cycle.
    if (notificationQueueName) {
      sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: 'NotificationQueueSend',
          actions: ['sqs:SendMessage'],
          resources: [
            `arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${notificationQueueName}`,
          ],
        }),
      );
    }

    // Grant audit queue send permission to all REST Lambda handlers (for audit middleware).
    if (auditLogQueueName) {
      sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: 'AuditQueueSend',
          actions: ['sqs:SendMessage'],
          resources: [
            `arn:aws:sqs:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:${auditLogQueueName}`,
          ],
        }),
      );
    }

    // EventBridge bus for opportunity events (GO decision → POC generation)
    // Bus is created by OpportunityEventsStack — shared across all stages.
    // The bus name is fixed; org-level enablePOCGeneration flag gates access.
    const opportunityEventBusName = 'auto-rfp-opportunity-events';
    const opportunityEventBus = events.EventBus.fromEventBusName(this, `OpportunityEventBus-${stage}`, opportunityEventBusName);

    commonEnv.OPPORTUNITY_EVENT_BUS_NAME = opportunityEventBus.eventBusName;

    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'EventBridgePutEvents',
        actions: ['events:PutEvents'],
        resources: [opportunityEventBus.eventBusArn],
      }),
    );

    // POC result listener: EventBridge → Lambda → resolve opportunity POC state.
    // Handles both POCDeploymentComplete (store pocUrl, mark succeeded) and
    // POCDeploymentFailed (store failure reason, mark failed) so the UI button
    // never stays stuck in "Generating…".
    const onPocResultFn = new lambdaNodejs.NodejsFunction(this, `OnPocResult-${stage}`, {
      functionName: `auto-rfp-on-poc-result-${stage}`,
      entry: path.join(__dirname, '../../../apps/functions/src/handlers/opportunity/on-poc-result.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 128,
      role: sharedInfraStack.commonLambdaRole,
      environment: commonEnv,
      bundling: { minify: true, sourceMap: true },
    });

    new logs.LogGroup(this, `OnPocResultLogGroup-${stage}`, {
      logGroupName: `/aws/lambda/${onPocResultFn.functionName}`,
      retention: stage === 'Prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const pocResultRule = new events.Rule(this, `POCDeploymentResultRule-${stage}`, {
      eventBus: opportunityEventBus,
      eventPattern: {
        source: ['development-platform.poc'],
        detailType: ['POCDeploymentComplete', 'POCDeploymentFailed'],
      },
    });
    pocResultRule.addTarget(new eventsTargets.LambdaFunction(onPocResultFn));

    // Grant SES send permission for FOIA auto-submit via email.
    //
    // The configuration-set ARN is required in addition to the identity: naming a
    // configuration set on a send is authorized separately, so without it SES
    // rejects the call outright — and that set is what routes bounces to the
    // handler, so a send that skipped it would be undeliverable-but-silent.
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SESFoiaSubmit',
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [
          `arn:aws:ses:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:identity/*`,
          `arn:aws:ses:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:configuration-set/*`,
        ],
      }),
    );

    if (execBriefQueue) {
      execBriefQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);

      // Create the exec-brief-worker Lambda to process SQS messages
      const execBriefWorker = new lambdaNodejs.NodejsFunction(this, `ExecBriefWorker-${stage}`, {
        functionName: `auto-rfp-exec-brief-worker-${stage}`,
        entry: path.join(__dirname, '../../../apps/functions/src/handlers/brief/exec-brief-worker.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(5), // Match SQS visibility timeout
        memorySize: 1024,
        role: sharedInfraStack.commonLambdaRole,
        environment: {
          ...commonEnv,
          BRIEF_MAX_SOLICITATION_CHARS: '150000',
          BRIEF_MAX_SOLICITATION_CHARS_REQUIREMENTS: '200000',
          BRIEF_KB_TOPK: '20',
          COST_SAVING: 'true',
          GOOGLE_DRIVE_SYNC_QUEUE_URL: googleDriveSyncQueue?.queueUrl || '',
        },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*', '@smithy/*'],
        },
      });

      // Add SQS event source to trigger the Lambda
      execBriefWorker.addEventSource(
        new lambdaEventSources.SqsEventSource(execBriefQueue, {
          batchSize: 1, // Process one message at a time for reliability
          reportBatchItemFailures: true, // Enable partial batch response
        }),
      );

      // Grant the worker Lambda permission to consume messages from the queue
      execBriefQueue.grantConsumeMessages(execBriefWorker);
    }

    // Google Drive Sync worker — processes async Drive sync messages
    const gdSyncQueueUrl = googleDriveSyncQueue?.queueUrl || '';
    if (googleDriveSyncQueue) {
      googleDriveSyncQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);

      const googleDriveSyncWorker = new lambdaNodejs.NodejsFunction(this, `GoogleDriveSyncWorker-${stage}`, {
        functionName: `auto-rfp-gdrive-sync-worker-${stage}`,
        entry: path.join(__dirname, '../../../apps/functions/src/handlers/google/google-drive-sync-worker.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(5),
        memorySize: 512,
        role: sharedInfraStack.commonLambdaRole,
        environment: { ...commonEnv },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*', '@smithy/*'],
        },
      });

      googleDriveSyncWorker.addEventSource(
        new lambdaEventSources.SqsEventSource(googleDriveSyncQueue, {
          batchSize: 1,
          reportBatchItemFailures: true,
        }),
      );

      googleDriveSyncQueue.grantConsumeMessages(googleDriveSyncWorker);
    }

    // Clarifying Question worker — processes async clarifying question generation (Bedrock calls)
    const clarifyingQuestionQueue = props.clarifyingQuestionQueue;
    const clarifyingQuestionQueueUrl = clarifyingQuestionQueue?.queueUrl || '';
    if (clarifyingQuestionQueue) {
      clarifyingQuestionQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);

      const clarifyingQuestionWorker = new lambdaNodejs.NodejsFunction(this, `ClarifyingQuestionWorker-${stage}`, {
        functionName: `auto-rfp-clarifying-question-worker-${stage}`,
        entry: path.join(__dirname, '../../../apps/functions/src/handlers/clarifying-question/clarifying-question-worker.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(3), // Match SQS visibility timeout
        memorySize: 1024,
        role: sharedInfraStack.commonLambdaRole,
        environment: { ...commonEnv },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*', '@smithy/*'],
        },
      });

      clarifyingQuestionWorker.addEventSource(
        new lambdaEventSources.SqsEventSource(clarifyingQuestionQueue, {
          batchSize: 1,
          reportBatchItemFailures: true,
        }),
      );

      clarifyingQuestionQueue.grantConsumeMessages(clarifyingQuestionWorker);

      // Add log group for the worker
      new logs.LogGroup(this, `ClarifyingQuestionWorkerLogs-${stage}`, {
        logGroupName: `/aws/lambda/auto-rfp-clarifying-question-worker-${stage}`,
        retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }

    // Document Generation worker — processes async Bedrock document generation
    const docGenQueueUrl = documentGenerationQueue?.queueUrl || '';
    if (documentGenerationQueue) {
      documentGenerationQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);

      const docGenWorker = new lambdaNodejs.NodejsFunction(this, `DocGenWorker-${stage}`, {
        functionName: `auto-rfp-doc-gen-worker-${stage}`,
        entry: path.join(__dirname, '../../../apps/functions/src/handlers/rfp-document/generate-document-worker.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(10), // Match SQS visibility timeout
        memorySize: 1024,
        role: sharedInfraStack.commonLambdaRole,
        environment: {
          ...commonEnv,
          PROPOSAL_MAX_SOLICITATION_CHARS: '80000',
          BEDROCK_MAX_TOKENS: '40000',
          BEDROCK_TEMPERATURE: '0.1',
          // Required for CLARIFYING_QUESTIONS document type to auto-trigger question generation
          CLARIFYING_QUESTION_QUEUE_URL: clarifyingQuestionQueueUrl,
          // Required for retry logic: worker needs to re-enqueue failed jobs
          DOCUMENT_GENERATION_QUEUE_URL: docGenQueueUrl,
        },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*', '@smithy/*'],
          nodeModules: ['exceljs'],
        },
      });

      docGenWorker.addEventSource(
        new lambdaEventSources.SqsEventSource(documentGenerationQueue, {
          batchSize: 1,
          reportBatchItemFailures: true,
        }),
      );

      documentGenerationQueue.grantConsumeMessages(docGenWorker);
    }

    // Extraction worker — processes async past performance/pricing extraction
    const extractionQueue = props.extractionQueue;
    const extractionQueueUrl = extractionQueue?.queueUrl || '';
    if (extractionQueue) {
      extractionQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);

      const extractionWorker = new lambdaNodejs.NodejsFunction(this, `ExtractionWorker-${stage}`, {
        functionName: `auto-rfp-extraction-worker-${stage}`,
        entry: path.join(__dirname, '../../../apps/functions/src/handlers/extraction/extraction-worker.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(15), // Match SQS visibility timeout
        memorySize: 1024,
        role: sharedInfraStack.commonLambdaRole,
        environment: {
          ...commonEnv,
        },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*', '@smithy/*', 'pdf-parse'],
          nodeModules: ['pdf-parse'], // pdf-parse uses dynamic require, must be installed
        },
      });

      extractionWorker.addEventSource(
        new lambdaEventSources.SqsEventSource(extractionQueue, {
          batchSize: 1,
          reportBatchItemFailures: true,
        }),
      );

      extractionQueue.grantConsumeMessages(extractionWorker);

      // Add log group for the worker
      new logs.LogGroup(this, `ExtractionWorkerLogs-${stage}`, {
        logGroupName: `/aws/lambda/auto-rfp-extraction-worker-${stage}`,
        retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }

    // 3. Collect all domain route definitions
    const allDomains: DomainRoutes[] = [
      organizationDomain(),
      answerDomain(),
      briefDomain({ execBriefQueueUrl: execBriefQueue?.queueUrl || '', googleDriveSyncQueueUrl: gdSyncQueueUrl, frontendUrl: props.frontendUrl }),
      presignedDomain(),
      knowledgebaseDomain(),
      documentDomain(),
      questionfileDomain(),
      userDomain(),
      questionDomain(),
      semanticDomain(),
      deadlinesDomain(),
      opportunityDomain(),
      contentlibraryDomain(),
      foiaDomain(),
      debriefingDomain(),
      pastperfDomain({ execBriefQueueUrl: execBriefQueue?.queueUrl || '' }),
      projectsDomain(),
      promptDomain(),
      searchOpportunityDomain(),
      rfpDocumentDomain({ documentGenerationQueueUrl: docGenQueueUrl }),
      templateDomain(),
      linearRoutes,
      googleDomain(),
      clusteringDomain(),
      collaborationDomain(),
      opportunityContextDomain(),
      notificationDomain(),
      auditDomain(),
      analyticsDomain(),
      clarifyingQuestionDomain(clarifyingQuestionQueueUrl),
      engagementLogDomain(),
      apnDomain(),
      proposalSubmissionDomain(),
      documentApprovalDomain(),
      universalApprovalDomain(),
      pricingDomain(),
      extractionDomain({ extractionQueueUrl }),
      opportunityAssistantDomain(),
      complianceReviewDomain(),
      packageEditDomain(),
      questionnaireDomain(),
      companyProfileDomain(),
      requiredFormsDomain(),
      dashboardDomain(),
      solutionPlanDomain(),
      relatedRfpDomain(),
      employeeDomain({ extractionQueueUrl }),
    ];

    // ─── Compliance Review worker ─────────────────────────────────────────
    // Processes async full-package review jobs (Sonnet, no API Gateway 29s
    // limit). REST handlers enqueue via COMPLIANCE_REVIEW_QUEUE_URL (in commonEnv).
    complianceReviewQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);
    const complianceReviewWorker = new lambdaNodejs.NodejsFunction(this, `ComplianceReviewWorker-${stage}`, {
      functionName: `auto-rfp-compliance-review-worker-${stage}`,
      entry: path.join(__dirname, '../../../apps/functions/src/handlers/compliance-review/review-worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15), // Lambda max; < queue visibility timeout (16m)
      memorySize: 1024,
      role: sharedInfraStack.commonLambdaRole,
      environment: { ...commonEnv },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });
    complianceReviewWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(complianceReviewQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );
    complianceReviewQueue.grantConsumeMessages(complianceReviewWorker);

    // ─── Solution Plan worker ─────────────────────────────────────────────
    // Processes one grilling round (or the final synthesis) per SQS message.
    // REST handlers enqueue round 1 via SOLUTION_PLAN_QUEUE_URL (in commonEnv);
    // the worker re-enqueues the next round itself (step-per-round, T6).
    solutionPlanQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);
    const solutionPlanWorker = new lambdaNodejs.NodejsFunction(this, `SolutionPlanWorker-${stage}`, {
      functionName: `auto-rfp-solution-plan-worker-${stage}`,
      entry: path.join(__dirname, '../../../apps/functions/src/handlers/solution-plan/solution-plan-worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(10), // < queue visibility timeout (16m)
      memorySize: 1024,
      role: sharedInfraStack.commonLambdaRole,
      environment: {
        ...commonEnv,
        // Tech Lead + Synthesizer fall back to BEDROCK_MODEL_ID; the no-tools
        // Griller turns run on the cheaper fast model.
        SOLUTION_PLAN_GRILLER_MODEL_ID: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
        SOLUTION_PLAN_MAX_ROUNDS: '4',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });
    solutionPlanWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(solutionPlanQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );
    solutionPlanQueue.grantConsumeMessages(solutionPlanWorker);

    new logs.LogGroup(this, `SolutionPlanWorkerLogs-${stage}`, {
      logGroupName: `/aws/lambda/auto-rfp-solution-plan-worker-${stage}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Package Edit worker ──────────────────────────────────────────────
    // Processes async cross-package "Mass Edit" proposal scans (Sonnet, no 29s
    // limit). REST handlers enqueue via PACKAGE_EDIT_QUEUE_URL (in commonEnv).
    // Clone of the compliance-review worker.
    packageEditQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);
    const packageEditWorkerFunctionName = `auto-rfp-package-edit-worker-${stage}`;
    const packageEditWorker = new lambdaNodejs.NodejsFunction(this, `PackageEditWorker-${stage}`, {
      functionName: packageEditWorkerFunctionName,
      entry: path.join(__dirname, '../../../apps/functions/src/handlers/package-edit/propose-worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15), // Lambda max; < queue visibility timeout (16m)
      memorySize: 1024,
      role: sharedInfraStack.commonLambdaRole,
      environment: { ...commonEnv },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });
    packageEditWorker.addEventSource(
      new lambdaEventSources.SqsEventSource(packageEditQueue, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );
    packageEditQueue.grantConsumeMessages(packageEditWorker);

    // Explicit log group with controlled retention (the compliance worker relies
    // on the auto-created group; package-edit gets an explicit one for
    // observability + retention control, mirroring RasterizePdfWorkerLogs).
    new logs.LogGroup(this, `PackageEditWorkerLogs-${stage}`, {
      logGroupName: `/aws/lambda/${packageEditWorkerFunctionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Rasterize PDF worker ─────────────────────────────────────────────
    // Owns the heavy pdfjs-dist + @napi-rs/canvas deps so callers
    // (export-rfp-document, export-all-rfp-documents, etc.) stay under the
    // 250 MB unzipped Lambda hard limit. Must be created BEFORE the domain
    // stacks below so the function name lands in commonEnv before route
    // Lambdas read it.
    const rasterizePdfFunctionName = `auto-rfp-rasterize-pdf-${stage}`;
    new lambdaNodejs.NodejsFunction(this, `RasterizePdfWorker-${stage}`, {
      functionName: rasterizePdfFunctionName,
      entry: path.join(__dirname, '../../../apps/functions/src/handlers/required-forms/rasterize-pdf-worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 2048,
      role: sharedInfraStack.commonLambdaRole,
      environment: { ...commonEnv },
      bundling: {
        minify: true,
        sourceMap: false,
        target: 'es2022',
        format: lambdaNodejs.OutputFormat.CJS,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/*', '@smithy/*'],
        nodeModules: ['pdfjs-dist', '@napi-rs/canvas', '@napi-rs/canvas-linux-x64-gnu'],
      },
    });

    new logs.LogGroup(this, `RasterizePdfWorkerLogs-${stage}`, {
      logGroupName: `/aws/lambda/${rasterizePdfFunctionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Allow the shared Lambda role (used by all route Lambdas) to invoke the worker.
    // Use a string-built ARN — calling rasterizePdfWorker.grantInvoke(role) would
    // create a cycle (SharedInfra → RasterizePdfWorker via the IAM policy, and
    // RasterizePdfWorker → SharedInfra via its execution role + commonEnv).
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeRasterizePdfWorker',
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${rasterizePdfFunctionName}`,
        ],
      }),
    );

    // Pass the function name to every downstream route Lambda via commonEnv.
    sharedInfraStack.commonEnv.RASTERIZE_PDF_FUNCTION_NAME = rasterizePdfFunctionName;

    // ─── HigherGov async search worker ────────────────────────────────────
    // HigherGov's /opportunity/ API takes ~30s+ for some saved searches, past
    // the API Gateway 30s ceiling — so a search_id search can't complete inline.
    // This worker (not fronted by API Gateway) performs the fetch fire-and-forget
    // and writes results to a DynamoDB cache row the search handler reads and the
    // frontend polls. Created before the domain stacks so its name lands in
    // commonEnv first. 60s timeout gives headroom over the observed ~32s fetch.
    const higherGovSearchFunctionName = `auto-rfp-highergov-search-${stage}`;
    new lambdaNodejs.NodejsFunction(this, `HigherGovSearchWorker-${stage}`, {
      functionName: higherGovSearchFunctionName,
      entry: path.join(__dirname, '../../../apps/functions/src/handlers/search-opportunity/highergov-search-worker.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      // 120s: HigherGov's /opportunity/ has been observed as slow as ~60s on a
      // cold saved-search fetch (fast, ~34s, once warm). Headroom over the worst
      // case lets the fetch finish in one invocation instead of relying on
      // Lambda's async retry (which pushes first-paste results out to ~90s+).
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      role: sharedInfraStack.commonLambdaRole,
      environment: { ...commonEnv },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });

    new logs.LogGroup(this, `HigherGovSearchWorkerLogs-${stage}`, {
      logGroupName: `/aws/lambda/${higherGovSearchFunctionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Allow the shared Lambda role to invoke the worker (string-built ARN to
    // avoid a SharedInfra ⇄ worker dependency cycle — same reasoning as above).
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeHigherGovSearchWorker',
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${higherGovSearchFunctionName}`,
        ],
      }),
    );

    sharedInfraStack.commonEnv.HIGHERGOV_SEARCH_FUNCTION_NAME = higherGovSearchFunctionName;

    // ─── Find Related RFPs worker (HOR-2610) ──────────────────────────────
    // Auto-discovers past/present RFPs from the same solicitation agency via
    // HigherGov (not fronted by API Gateway — invoked fire-and-forget after a
    // HigherGov-sourced import and by the manual `refresh` route). Created BEFORE
    // the domain stacks so its function name lands in commonEnv first.
    const findRelatedRfpsFunctionName = `auto-rfp-find-related-rfps-${stage}`;
    new lambdaNodejs.NodejsFunction(this, `FindRelatedRfpsWorker-${stage}`, {
      functionName: findRelatedRfpsFunctionName,
      entry: path.join(__dirname, '../../../apps/functions/src/handlers/related-rfp/find-related-rfps.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      role: sharedInfraStack.commonLambdaRole,
      environment: { ...commonEnv },
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*', '@smithy/*'],
      },
    });

    new logs.LogGroup(this, `FindRelatedRfpsWorkerLogs-${stage}`, {
      logGroupName: `/aws/lambda/${findRelatedRfpsFunctionName}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'InvokeFindRelatedRfpsWorker',
        actions: ['lambda:InvokeFunction'],
        resources: [
          `arn:aws:lambda:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:function:${findRelatedRfpsFunctionName}`,
        ],
      }),
    );

    sharedInfraStack.commonEnv.FIND_RELATED_RFPS_FUNCTION_NAME = findRelatedRfpsFunctionName;

    // 4. Create nested stacks per domain (Lambda + LogGroup + Route registration)
    //    Each nested stack stays under CloudFormation's 500 resource limit.
    //    Routes are HttpApi routes (no resource tree limit like REST API).
    // IMPORTANT: Use the EXACT same logical IDs as the old REST API nested stacks
    // so CloudFormation updates them in-place rather than delete+recreate (which
    // would fail due to cross-stack export dependencies).
    const domainStackNames = [
      'OrganizationRoutes', 'AnswerRoutes', 'BriefRoutes', 'PresignedRoutes',
      'KnowledgebaseRoutes', 'DocumentRoutes', 'QuestionfileRoutes', 'UserRoutes',
      'QuestionRoutes', 'SemanticRoutes', 'DeadlinesRoutes', 'OpportunityRoutes',
      'ContentLibraryRoutes', 'FoiaRoutes', 'DebriefingRoutes',
      'PastPerfRoutes', 'ProjectsRoutes', 'PromptRoutes', 'SearchOpportunityRoutes',
      'RfpDocumentRoutes', 'TemplateRoutes', 'LinearRoutes', 'GoogleRoutes',
      'ClusteringRoutes', 'CollaborationRoutes', 'OpportunityContextRoutes',
      'NotificationRoutes', 'AuditRoutes', 'AnalyticsRoutes', 'ClarifyingQuestionRoutes',
      'EngagementLogRoutes', 'ApnRoutes', 'ProposalSubmissionRoutes',
      'DocumentApprovalRoutes', 'UniversalApprovalRoutes', 'PricingRoutes', 'ExtractionRoutes',
      'OpportunityAssistantRoutes',
      'ComplianceReviewRoutes',
      'PackageEditRoutes',
      'QuestionnaireRoutes',
      'CompanyProfileRoutes',
      'RequiredFormsRoutes',
      'DashboardRoutes',
      'SolutionPlanRoutes',
      'RelatedRfpRoutes',
      'EmployeeRoutes',
    ];

    // allDomains and domainStackNames are mapped 1:1 by index. A mismatch silently
    // reshuffles which nested stack owns which routes, causing ApiGatewayV2 409
    // "Route already exists" conflicts at deploy time. Fail fast at synth instead.
    if (allDomains.length !== domainStackNames.length) {
      throw new Error(
        `allDomains (${allDomains.length}) and domainStackNames (${domainStackNames.length}) must have the same length and stay index-aligned.`,
      );
    }

    for (let i = 0; i < allDomains.length; i++) {
      new ApiDomainLambdaStack(this, domainStackNames[i]!, {
        httpApi: this.httpApi,
        userPoolId: userPool.userPoolId,
        lambdaRole: sharedInfraStack.commonLambdaRole,
        commonEnv: sharedInfraStack.commonEnv,
        domain: allDomains[i]!,
        authorizer: jwtAuthorizer,
      });
    }

    // 5. Create stage with auto-deploy
    const apiStage = new apigwv2.HttpStage(this, 'HttpApiStage', {
      httpApi: this.httpApi,
      stageName: stage,
      autoDeploy: true,
    });

    this.apiUrl = apiStage.url ?? '';

    // ─── DIBBS run-saved-search scheduler ────────────────────────────────────
    const dibbsRunSavedSearchFn = new lambdaNodejs.NodejsFunction(this, `DibbsRunSavedSearch-${stage}`, {
      functionName: `auto-rfp-dibbs-run-saved-search-${stage}`,
      entry: path.join(__dirname, '../../../apps/functions/src/handlers/search-opportunity/run-saved-search.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(5),
      memorySize: 256,
      role: sharedInfraStack.commonLambdaRole,
      environment: { ...commonEnv },
      bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*', '@smithy/*'] },
    });

    new logs.LogGroup(this, `DibbsRunSavedSearchLogs-${stage}`, {
      logGroupName: `/aws/lambda/auto-rfp-dibbs-run-saved-search-${stage}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    new events.Rule(this, `DibbsRunSavedSearchRule-${stage}`, {
      ruleName: `auto-rfp-dibbs-run-saved-search-${stage}`,
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
      targets: [
        new eventsTargets.LambdaFunction(dibbsRunSavedSearchFn, {
          event: events.RuleTargetInput.fromObject({ dryRun: false }),
        }),
      ],
    });

    // ─── Proposal Submission Lambda CloudWatch Log Groups ─────────────────────
    const proposalSubmissionHandlers = [
      'get-submission-readiness',
      'check-compliance',
      'submit-proposal',
      'get-submission-history',
      'withdraw-submission',
    ];

    for (const handlerName of proposalSubmissionHandlers) {
      new logs.LogGroup(this, `ProposalSubmissionLogs-${handlerName}-${stage}`, {
        logGroupName: `/aws/lambda/auto-rfp-proposal-submission-${handlerName}-${stage}`,
        retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }

    // Grant Lambda role access to Partner Central API (APN opportunities CRUD)
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'PartnerCentralAccess',
        actions: [
          'partnercentral:CreateOpportunity',
          'partnercentral:GetOpportunity',
          'partnercentral:UpdateOpportunity',
          'partnercentral:ListOpportunities',
          'partnercentral:AssignOpportunity',
          'partnercentral:SubmitOpportunity',
        ],
        resources: ['*'],
      }),
    );


    // ─── Re-extract Questions Lambda CloudWatch Log Group ─────────────────────
    new logs.LogGroup(this, `ReextractQuestionsLogs-${stage}`, {
      logGroupName: `/aws/lambda/auto-rfp-questionfile-reextract-questions-${stage}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
    });

    // ─── Re-extract All Questions Lambda CloudWatch Log Group ──────────────────
    new logs.LogGroup(this, `ReextractAllQuestionsLogs-${stage}`, {
      logGroupName: `/aws/lambda/auto-rfp-questionfile-reextract-all-questions-${stage}`,
      retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── Document Approval Lambda CloudWatch Log Groups ───────────────────────
    const documentApprovalHandlers = [
      'request-approval',
      'submit-review',
      'get-approval-history',
      'resubmit-for-review',
      'bulk-review',
    ];

    for (const handlerName of documentApprovalHandlers) {
      new logs.LogGroup(this, `DocumentApprovalLogs-${handlerName}-${stage}`, {
        logGroupName: `/aws/lambda/auto-rfp-document-approval-${handlerName}-${stage}`,
        retention: stage === 'prod' ? logs.RetentionDays.INFINITE : logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });
    }

    new cdk.CfnOutput(this, 'RestApiId', {
      value: this.restApiId,
    });

    new cdk.CfnOutput(this, 'RootResourceId', {
      value: this.rootResourceId,
    });

    new cdk.CfnOutput(this, 'CommonLambdaRoleArn', {
      value: this.commonLambdaRoleArn,
    });

    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: this.apiUrl,
    });

    // Write API URL to SSM so AmplifyFeStack can read it without cross-stack exports
    new cdk.aws_ssm.StringParameter(this, 'ApiUrlParam', {
      parameterName: `/auto-rfp/${stage}/api-url`,
      stringValue: this.apiUrl,
      description: 'HTTP API v2 base URL',
    });
  }
}