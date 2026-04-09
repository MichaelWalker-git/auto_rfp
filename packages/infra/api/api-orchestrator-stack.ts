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
import { projectoutcomeDomain } from './routes/project-outcome.routes';
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
import { pricingDomain } from './routes/pricing.routes';

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
  notificationQueueName?: string;
  auditLogQueueName?: string;
  documentPipelineStateMachineArn: string;
  questionPipelineStateMachineArn: string;
  sentryDNS: string;
  pineconeApiKey: string;
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
      sentryDNS,
      pineconeApiKey,
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
    const commonEnv: Record<string, string> = {
      STAGE: stage,
      AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      NODE_ENV: 'production',
      DB_TABLE_NAME: mainTable.tableName,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      DEFAULT_TEMP_PASSWORD: process.env.DEFAULT_TEMP_PASSWORD || 'Welcome1!',
      REGION: 'us-east-1',
      BEDROCK_REGION: 'us-east-1',
      BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
      BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
      STATE_MACHINE_ARN: documentPipelineStateMachineArn,
      QUESTION_PIPELINE_STATE_MACHINE_ARN: questionPipelineStateMachineArn,
      SENTRY_DSN: sentryDNS,
      SENTRY_ENVIRONMENT: stage,
      PINECONE_API_KEY: pineconeApiKey,
      PINECONE_INDEX: 'documents',
      SAM_OPPS_BASE_URL: 'https://api.sam.gov',
      DIBBS_BASE_URL: 'https://www.dibbs.bsm.dla.mil',
      // Verified SES sender identity — horustech.dev domain must be verified in SES
      SES_FROM_EMAIL: 'noreply@horustech.dev',
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

    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'StepFunctionsExecutionControl2', 
        actions: [
          'states:StartExecution',
          'states:StopExecution',
          'states:DescribeExecution',
        ],
        resources: [
          documentPipelineStateMachineArn,
          questionPipelineStateMachineArn,
          docPipelineExecutionArn,
          questionPipelineExecutionArn,
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
    // Bus is created by DevelopmentPlatform stack — only available in Dev
    const opportunityEventBusName = `auto-rfp-opportunity-events-${stage.toLowerCase()}`;
    if (stage === 'Dev') {
      const opportunityEventBus = events.EventBus.fromEventBusName(this, `OpportunityEventBus-${stage}`, opportunityEventBusName);

      commonEnv.OPPORTUNITY_EVENT_BUS_NAME = opportunityEventBus.eventBusName;

      sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
        new iam.PolicyStatement({
          sid: 'EventBridgePutEvents',
          actions: ['events:PutEvents'],
          resources: [opportunityEventBus.eventBusArn],
        }),
      );

      // POC completion listener: EventBridge → Lambda → update opportunity with pocUrl
      const onPocCompleteFn = new lambdaNodejs.NodejsFunction(this, `OnPocComplete-${stage}`, {
        functionName: `auto-rfp-on-poc-complete-${stage}`,
        entry: path.join(__dirname, '../../../apps/functions/src/handlers/opportunity/on-poc-complete.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        memorySize: 128,
        role: sharedInfraStack.commonLambdaRole,
        environment: commonEnv,
        bundling: { minify: true, sourceMap: true },
      });

      new logs.LogGroup(this, `OnPocCompleteLogGroup-${stage}`, {
        logGroupName: `/aws/lambda/${onPocCompleteFn.functionName}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const pocCompleteRule = new events.Rule(this, `POCDeploymentCompleteRule-${stage}`, {
        eventBus: opportunityEventBus,
        eventPattern: {
          source: ['development-platform.poc'],
          detailType: ['POCDeploymentComplete'],
        },
      });
      pocCompleteRule.addTarget(new eventsTargets.LambdaFunction(onPocCompleteFn));
    }

    // Grant SES send permission for FOIA auto-submit via email
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SESFoiaSubmit',
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: [`arn:aws:ses:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:identity/*`],
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
          BRIEF_MAX_SOLICITATION_CHARS: '45000',
          BRIEF_KB_TOPK: '20',
          COST_SAVING: 'true',
          GOOGLE_DRIVE_SYNC_QUEUE_URL: googleDriveSyncQueue?.queueUrl || '',
        },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*'],
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
          externalModules: ['@aws-sdk/*'],
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
          externalModules: ['@aws-sdk/*'],
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
        },
        bundling: {
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*'],
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

    // 3. Collect all domain route definitions
    const allDomains: DomainRoutes[] = [
      organizationDomain(),
      answerDomain(),
      briefDomain({ execBriefQueueUrl: execBriefQueue?.queueUrl || '', googleDriveSyncQueueUrl: gdSyncQueueUrl }),
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
      projectoutcomeDomain(),
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
      pricingDomain(),
    ];

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
      'ContentLibraryRoutes', 'ProjectOutcomeRoutes', 'FoiaRoutes', 'DebriefingRoutes',
      'PastPerfRoutes', 'ProjectsRoutes', 'PromptRoutes', 'SearchOpportunityRoutes',
      'RfpDocumentRoutes', 'TemplateRoutes', 'LinearRoutes', 'GoogleRoutes',
      'ClusteringRoutes', 'CollaborationRoutes', 'OpportunityContextRoutes',
      'NotificationRoutes', 'AuditRoutes', 'AnalyticsRoutes', 'ClarifyingQuestionRoutes',
      'EngagementLogRoutes', 'ApnRoutes', 'ProposalSubmissionRoutes',
      'DocumentApprovalRoutes', 'PricingRoutes',
    ];

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
      bundling: { minify: true, sourceMap: true, externalModules: ['@aws-sdk/*'] },
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