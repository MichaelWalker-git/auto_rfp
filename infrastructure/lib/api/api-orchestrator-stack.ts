import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import * as crypto from 'crypto';

import { ApiSharedInfraStack } from './api-shared-infra-stack';
import { ApiDomainRoutesStack } from './api-domain-resource-stack';
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
import { exportDomain } from './routes/export.routes';
import { contentlibraryDomain } from './routes/content-library.routes';
import { projectoutcomeDomain } from './routes/project-outcome.routes';
import { projectsDomain } from './routes/projects.routes';
import { promptDomain } from './routes/prompt.routes';
import { samgovDomain } from './routes/samgov.routes';
import { linearRoutes } from './routes/linear.routes';
import { briefDomain } from './routes/brief.routes';
import { pastperfDomain } from './routes/pastperf.routes';
import { rfpDocumentDomain } from './routes/rfp-document.routes';
import { templateDomain } from './routes/template.routes';
import { googleDomain } from './routes/google.routes';
import { clusteringDomain } from './routes/clustering.routes';

export interface ApiOrchestratorStackProps extends cdk.StackProps {
  stage: string;
  userPool: cognito.IUserPool;
  mainTable: dynamodb.ITable;
  documentsBucket: s3.IBucket;
  execBriefQueue?: sqs.IQueue;
  googleDriveSyncQueue?: sqs.IQueue;
  documentGenerationQueue?: sqs.IQueue;
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
  public readonly restApiId: string;
  public readonly rootResourceId: string;
  public readonly commonLambdaRoleArn: string;
  public readonly api: apigateway.RestApi;
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: ApiOrchestratorStackProps) {
    super(scope, id, props);

    const {
      stage,
      userPool,
      mainTable,
      documentsBucket,
      execBriefQueue,
      googleDriveSyncQueue,
      documentGenerationQueue,
      documentPipelineStateMachineArn,
      questionPipelineStateMachineArn,
      sentryDNS,
      pineconeApiKey,
    } = props;

    // 1. Create API Gateway REST API directly in this stack
    // Disable automatic deployment to avoid circular dependencies with nested stacks
    this.api = new apigateway.RestApi(this, 'AutoRfpApi', {
      restApiName: `AutoRFP API (${stage})`,
      deploy: false, // We'll create deployment manually after all routes are added
      cloudWatchRole: true,
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
    });

    this.restApiId = this.api.restApiId;
    this.rootResourceId = this.api.restApiRootResourceId;

    // Create Cognito authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'CognitoAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: `${stage}-cognito-authorizer`,
    });

    // 2. Create shared infrastructure (Lambda role + common env)
    const commonEnv: Record<string, string> = {
      STAGE: stage,
      AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      NODE_ENV: 'production',
      DB_TABLE_NAME: mainTable.tableName,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
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
    };

    const sharedInfraStack = new ApiSharedInfraStack(this, 'SharedInfra', {
      stage,
      commonEnv,
    });

    this.commonLambdaRoleArn = sharedInfraStack.commonLambdaRole.roleArn;

    // Grant Lambda role access to resources
    mainTable.grantReadWriteData(sharedInfraStack.commonLambdaRole);
    documentsBucket.grantReadWrite(sharedInfraStack.commonLambdaRole);

    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
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

    if (execBriefQueue) {
      execBriefQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);

      // Create the exec-brief-worker Lambda to process SQS messages
      const execBriefWorker = new lambdaNodejs.NodejsFunction(this, `ExecBriefWorker-${stage}`, {
        functionName: `auto-rfp-exec-brief-worker-${stage}`,
        entry: path.join(__dirname, '../../lambda/brief/exec-brief-worker.ts'),
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
        entry: path.join(__dirname, '../../lambda/google/google-drive-sync-worker.ts'),
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

    // Document Generation worker — processes async Bedrock document generation
    const docGenQueueUrl = documentGenerationQueue?.queueUrl || '';
    if (documentGenerationQueue) {
      documentGenerationQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);

      const docGenWorker = new lambdaNodejs.NodejsFunction(this, `DocGenWorker-${stage}`, {
        functionName: `auto-rfp-doc-gen-worker-${stage}`,
        entry: path.join(__dirname, '../../lambda/rfp-document/generate-document-worker.ts'),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.minutes(10), // Match SQS visibility timeout
        memorySize: 1024,
        role: sharedInfraStack.commonLambdaRole,
        environment: {
          ...commonEnv,
          PROPOSAL_MAX_SOLICITATION_CHARS: '80000',
          BEDROCK_MAX_TOKENS: '4000',
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

    // 3. Collect all domain route definitions for hashing and nested stack creation
    // This ensures the deployment is recreated whenever any route definition changes
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
      exportDomain(),
      contentlibraryDomain(),
      projectoutcomeDomain(),
      foiaDomain(),
      debriefingDomain(),
      pastperfDomain({ execBriefQueueUrl: execBriefQueue?.queueUrl || '' }),
      projectsDomain(),
      promptDomain(),
      samgovDomain(),
      rfpDocumentDomain({ documentGenerationQueueUrl: docGenQueueUrl }),
      templateDomain(),
      linearRoutes,
      googleDomain(),
      clusteringDomain(),
    ];

    // Compute a hash of all route definitions so the deployment logical ID changes
    // whenever routes are added, removed, or modified
    const routeFingerprint = crypto
      .createHash('sha256')
      .update(
        JSON.stringify(
          allDomains.map((d) => ({
            basePath: d.basePath,
            routes: d.routes.map((r) => ({
              method: r.method,
              path: r.path,
              entry: r.entry,
              auth: r.auth,
            })),
          })),
        ),
      )
      .digest('hex')
      .substring(0, 16);

    const domainStackNames = [
      'OrganizationRoutes',
      'AnswerRoutes',
      'BriefRoutes',
      'PresignedRoutes',
      'KnowledgebaseRoutes',
      'DocumentRoutes',
      'QuestionfileRoutes',
      'UserRoutes',
      'QuestionRoutes',
      'SemanticRoutes',
      'DeadlinesRoutes',
      'OpportunityRoutes',
      'ExportRoutes',
      'ContentLibraryRoutes',
      'ProjectOutcomeRoutes',
      'FoiaRoutes',
      'DebriefingRoutes',
      'PastPerfRoutes',
      'ProjectsRoutes',
      'PromptRoutes',
      'SamgovRoutes',
      'RfpDocumentRoutes',
      'TemplateRoutes',
      'LinearRoutes',
      'GoogleRoutes',
      'ClusteringRoutes',
    ];

    const routeNestedStacks: ApiDomainRoutesStack[] = [];

    for (let i = 0; i < allDomains.length; i++) {
      const stackName = domainStackNames[i]!;
      const domain = allDomains[i]!;
      const stack = new ApiDomainRoutesStack(this, stackName, {
        api: this.api,
        rootResourceId: this.rootResourceId,
        userPoolId: userPool.userPoolId,
        lambdaRole: sharedInfraStack.commonLambdaRole,
        commonEnv: sharedInfraStack.commonEnv,
        domain,
        authorizer,
      });
      routeNestedStacks.push(stack);
    }

    // 4. Create deployment manually AFTER all routes are added
    // This avoids circular dependencies between nested stacks and the deployment
    const deployment = new apigateway.Deployment(this, 'ApiDeployment', {
      api: this.api,
      description: `Deployment for ${stage} [${routeFingerprint}]`,
      retainDeployments: true, // Keep old deployments to avoid issues during updates
    });

    // Force a new deployment whenever route definitions change.
    // Without this, CloudFormation reuses the existing Deployment resource
    // and the stage never picks up new/changed endpoints.
    deployment.addToLogicalId(routeFingerprint);

    // Create the stage
    const apiStage = new apigateway.Stage(this, 'ApiStage', {
      deployment,
      stageName: stage,
      metricsEnabled: true,
      loggingLevel: apigateway.MethodLoggingLevel.INFO,
      dataTraceEnabled: true,
    });

    // Set the API URL
    this.apiUrl = apiStage.urlForPath('/');

    // IMPORTANT: The deployment must depend on ALL nested stacks
    // This ensures all routes are created before the deployment
    for (const nestedStack of routeNestedStacks) {
      deployment.node.addDependency(nestedStack);
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
      value: apiStage.urlForPath('/'),
    });
  }
}