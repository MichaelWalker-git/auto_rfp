import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';

import { ApiNestedStack } from './wrappers/api-nested-stack';

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  documentsBucket: s3.IBucket;
  mainTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  documentPipelineStateMachineArn: string;
  questionPipelineStateMachineArn: string;
  openSearchCollectionEndpoint: string;
  sentryDNS: string;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigw.RestApi;

  // Nested stacks
  private readonly organizationApi: ApiNestedStack;
  private readonly projectApi: ApiNestedStack;
  private readonly answerApi: ApiNestedStack;
  private readonly presignedUrlApi: ApiNestedStack;
  private readonly knowledgeBaseApi: ApiNestedStack;
  private readonly documentApi: ApiNestedStack;
  private readonly questionFileApi: ApiNestedStack;
  private readonly proposalApi: ApiNestedStack;
  private readonly briefApi: ApiNestedStack;
  private readonly userApi: ApiNestedStack;
  private readonly questionApi: ApiNestedStack;
  private readonly semanticApi: ApiNestedStack;
  private readonly samgovApi: ApiNestedStack;
  private readonly deadlinesApi: ApiNestedStack;
  private readonly promptApi: ApiNestedStack;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      stage,
      documentsBucket,
      mainTable,
      userPool,
      userPoolClient,
      documentPipelineStateMachineArn,
      questionPipelineStateMachineArn,
      openSearchCollectionEndpoint,
      sentryDNS,
    } = props;

    const commonEnv = this.buildCommonEnv({
      stage,
      documentsBucket,
      mainTable,
      userPool,
      userPoolClient,
      documentPipelineStateMachineArn,
      questionPipelineStateMachineArn,
      openSearchCollectionEndpoint,
      sentryDNS,
    });

    this.api = this.createRestApi(stage);

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, `${id}Authorizer`, {
      cognitoUserPools: [userPool],
    });

    // --- Exec brief worker + queue ---
    const execBriefQueue = this.createExecBriefQueue(stage);

    const lambdaRole = this.createCommonLambdaRole({
      stage,
      userPool,
      documentPipelineStateMachineArn,
      questionPipelineStateMachineArn,
      mainTable,
      documentsBucket,
      execBriefQueue
    });

    const samGovApiKeySecret = this.createSamGovSecret(stage);
    samGovApiKeySecret.grantRead(lambdaRole);

    const linearApiKeySecret = this.createLinearSecret(stage);
    linearApiKeySecret.grantRead(lambdaRole);

    this.createRunSavedSearches({
      stage,
      lambdaRole,
      commonEnv,
      samGovApiKeySecret,
      questionPipelineStateMachineArn,
    });

    const execBriefWorkerFn = this.createExecBriefWorker({
      stage,
      commonEnv,
      execBriefQueue,
      documentsBucket,
      mainTable,
      lambdaRole,
    });

    // --- Nested APIs ---
    const createNestedStack = (basePath: string) =>
      new ApiNestedStack(this, `${basePath}API`, {
        api: this.api,
        basePath,
        lambdaRole,
        commonEnv,
        userPool,
        authorizer,
      });

    this.organizationApi = createNestedStack('organization');
    this.projectApi = createNestedStack('project');
    this.answerApi = createNestedStack('answer');
    this.presignedUrlApi = createNestedStack('presigned');
    this.knowledgeBaseApi = createNestedStack('knowledgebase');
    this.questionFileApi = createNestedStack('questionfile');
    this.proposalApi = createNestedStack('proposal');
    this.briefApi = createNestedStack('brief');
    this.userApi = createNestedStack('user');
    this.questionApi = createNestedStack('question');
    this.documentApi = createNestedStack('document');
    this.deadlinesApi = createNestedStack('deadlines');
    this.semanticApi = createNestedStack('semantic');
    this.samgovApi = createNestedStack('samgov');
    this.promptApi = createNestedStack('prompt');

    // Routes
    this.addRoutes({ samGovApiKeySecret, execBriefQueue, linearApiKeySecret });

    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: this.api.url,
      description: 'Base URL for the AutoRFP API',
    });

    new cdk.CfnOutput(this, 'ExecBriefQueueUrl', {
      value: execBriefQueue.queueUrl,
    });

    new cdk.CfnOutput(this, 'ExecBriefWorkerName', {
      value: execBriefWorkerFn.functionName,
    });
  }

  // ----------------------------
  // Helpers
  // ----------------------------

  private createRestApi(stage: string) {
    return new apigw.RestApi(this, 'AutoRfpApi', {
      restApiName: `AutoRFP API (${stage})`,
      description: 'AutoRFP API Gateway',
      deployOptions: {
        stageName: stage,
        metricsEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
        allowCredentials: true,
      },
    });
  }

  private buildCommonEnv(args: {
    stage: string;
    documentsBucket: s3.IBucket;
    mainTable: dynamodb.ITable;
    userPool: cognito.IUserPool;
    userPoolClient: cognito.IUserPoolClient;
    documentPipelineStateMachineArn: string;
    questionPipelineStateMachineArn: string;
    openSearchCollectionEndpoint: string;
    sentryDNS: string;
  }): Record<string, string> {
    const {
      stage,
      documentsBucket,
      mainTable,
      userPool,
      userPoolClient,
      documentPipelineStateMachineArn,
      questionPipelineStateMachineArn,
      openSearchCollectionEndpoint,
      sentryDNS,
    } = args;

    return {
      STAGE: stage,
      AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      NODE_ENV: 'production',
      DB_TABLE_NAME: mainTable.tableName,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      REGION: 'us-east-1',
      BEDROCK_REGION: 'us-east-1',
      BEDROCK_API_KEY_SSM_PARAM: '/auto-rfp/bedrock/api-key',
      BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
      BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
      OPENSEARCH_INDEX: 'documents',
      STATE_MACHINE_ARN: documentPipelineStateMachineArn,
      QUESTION_PIPELINE_STATE_MACHINE_ARN: questionPipelineStateMachineArn,
      OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint,
      SENTRY_DSN: sentryDNS,
      SENTRY_ENVIRONMENT: stage,
      COST_SAVING: 'true',
      LINEAR_TEAM_ID: '014ad7fc-6875-4a34-973b-61d029c37116',
      LINEAR_DEFAULT_ASSIGNEE_ID: '74c2dcce-9583-4065-b86f-ff4cb98d3da9',
      LINEAR_PROJECT_ID: '823d8281-c41e-4e00-b541-f31a5c91af46',
    };
  }

  private createCommonLambdaRole(args: {
    stage: string;
    userPool: cognito.IUserPool;
    documentPipelineStateMachineArn: string;
    questionPipelineStateMachineArn: string;
    mainTable: dynamodb.ITable;
    documentsBucket: s3.IBucket;
    execBriefQueue: sqs.Queue;
  }): iam.Role {
    const {
      stage,
      userPool,
      documentPipelineStateMachineArn,
      questionPipelineStateMachineArn,
      mainTable,
      documentsBucket,
      execBriefQueue,
    } = args;

    const role = new iam.Role(this, 'CommonLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: `auto-rfp-api-lambda-role-${stage}`,
    });

    role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );

    const bedrockApiKeyParamArn = `arn:aws:ssm:us-east-1:${this.account}:parameter/auto-rfp/bedrock/api-key`;

    role.attachInlinePolicy(
      new iam.Policy(this, 'LambdaPolicy', {
        statements: [
          new iam.PolicyStatement({
            actions: ['execute-api:Invoke'],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            actions: ['s3:*'],
            resources: ['*'],
          }),
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
          new iam.PolicyStatement({
            actions: ['logs:*'],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            actions: ['states:StartExecution'],
            resources: [documentPipelineStateMachineArn],
          }),
          new iam.PolicyStatement({
            actions: ['states:StartExecution'],
            resources: [questionPipelineStateMachineArn],
          }),
          new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            actions: [
              'textract:StartDocumentTextDetection',
              'textract:GetDocumentTextDetection',
              'textract:DetectDocumentText',
            ],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            actions: ['aoss:*'],
            resources: ['*'],
          }),
          new iam.PolicyStatement({
            actions: ['es:ESHttpPost', 'es:ESHttpPut', 'es:ESHttpGet'],
            resources: [
              'arn:aws:es:us-west-2:039885961427:domain/prodopensearchd-lxtzjp7drbvs/*',
            ],
          }),
          new iam.PolicyStatement({
            actions: ['secretsmanager:GetSecretValue'],
            resources: [`${process.env.BB_PROD_CREDENTIALS_ARN || '*'}`],
          }),
          new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: [bedrockApiKeyParamArn],
          }),
        ],
      }),
    );

    role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['sqs:SendMessage', 'sqs:SendMessageBatch'],
        resources: [execBriefQueue.queueArn],
        effect: iam.Effect.ALLOW,
      }),
    );

    mainTable.grantReadWriteData(role);
    documentsBucket.grantReadWrite(role);

    return role;
  }

  private createSamGovSecret(stage: string): secretsmanager.ISecret {
    const localKey = process.env.SAM_GOV_API_KEY?.trim();

    if (!localKey) {
      throw new Error(
        [
          'Missing required env var: SAM_GOV_API_KEY',
          '',
          'This stack requires a SAM.gov API key at deploy time.',
          'Set it before running CDK:',
          '  export SAM_GOV_API_KEY="your-key-here"',
          '',
          `Stage: ${stage}`,
          'Secret target: auto-rfp/<stage>/samgov/apiKey',
        ].join('\n'),
      );
    }

    return new secretsmanager.Secret(this, `SamGovApiKeySecret-${stage}`, {
      secretName: `auto-rfp/${stage}/samgov/apiKey`,
      secretStringValue: cdk.SecretValue.unsafePlainText(localKey),
    });
  }

  private createRunSavedSearches(args: {
    stage: string;
    lambdaRole: iam.IRole;
    commonEnv: Record<string, string>;
    samGovApiKeySecret: secretsmanager.ISecret;
    questionPipelineStateMachineArn: string;
  }) {
    const { stage, lambdaRole, commonEnv, samGovApiKeySecret, questionPipelineStateMachineArn } = args;

    const fn = new lambdaNodejs.NodejsFunction(this, `RunSavedSearches-${stage}`, {
      functionName: `auto-rfp-${stage}-run-saved-searches`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/samgov/run-saved-search.ts'),
      handler: 'handler',
      role: lambdaRole,
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        ...commonEnv,
        SAM_OPPS_BASE_URL: 'https://api.sam.gov',
        SAM_API_ORIGIN: 'https://api.sam.gov',
        SAM_GOV_API_KEY_SECRET_ID: samGovApiKeySecret.secretArn,
        QUESTION_PIPELINE_STATE_MACHINE_ARN: questionPipelineStateMachineArn,
      },
      bundling: { externalModules: ['aws-sdk'] },
    });

    new logs.LogRetention(this, `RunSavedSearchesLogs-${stage}`, {
      logGroupName: `/aws/lambda/${fn.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const rule = new events.Rule(this, `RunSavedSearchesRule-${stage}`, {
      ruleName: `auto-rfp-${stage}-run-saved-searches-hourly`,
      description: 'Hourly runner to execute SAM saved searches for all orgs',
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
    });

    rule.addTarget(
      new targets.LambdaFunction(fn, {
        event: events.RuleTargetInput.fromObject({ dryRun: false }),
      }),
    );

    fn.addPermission(`AllowEventBridgeInvoke-${stage}`, {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: rule.ruleArn,
    });
  }

  private createLinearSecret(stage: string): secretsmanager.ISecret {
    return secretsmanager.Secret.fromSecretNameV2(
      this,
      `LinearApiKeySecret-${stage}`,
      `auto-rfp/${stage}/linear/apiKey`
    );
  }

  private createExecBriefQueue(stage: string): sqs.Queue {
    return new sqs.Queue(this, `ExecBriefQueue-${stage}`, {
      queueName: `auto-rfp-${stage}-exec-brief-queue`,
      visibilityTimeout: cdk.Duration.minutes(10),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: new sqs.Queue(this, `ExecBriefDLQ-${stage}`, {
          queueName: `auto-rfp-${stage}-exec-brief-dlq`,
          retentionPeriod: cdk.Duration.days(14),
        }),
        maxReceiveCount: 5,
      },
    });
  }

  private createExecBriefWorker(args: {
    stage: string;
    commonEnv: Record<string, string>;
    execBriefQueue: sqs.Queue;
    documentsBucket: s3.IBucket;
    mainTable: dynamodb.ITable;
    lambdaRole: iam.Role;
  }) {
    const { stage, commonEnv, execBriefQueue, documentsBucket, mainTable, lambdaRole } = args;

    const fn = new lambdaNodejs.NodejsFunction(this, `ExecBriefWorker-${stage}`, {
      functionName: `auto-rfp-${stage}-exec-brief-worker`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, '../lambda/brief/exec-brief-worker.ts'),
      handler: 'handler',
      role: lambdaRole,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(9),
      environment: {
        ...commonEnv,
        SCORING_RETRY_DELAY_SECONDS: '30',
        BRIEF_MAX_SOLICITATION_CHARS: '45000',
        BRIEF_KB_TOPK: '15',
        EXEC_BRIEF_QUEUE_URL: execBriefQueue.queueUrl,
      },
      bundling: { externalModules: ['aws-sdk'] },
    });

    fn.addEventSource(
      new SqsEventSource(execBriefQueue, {
        batchSize: 5,
        maxBatchingWindow: cdk.Duration.seconds(5),
        reportBatchItemFailures: true,
      }),
    );

    execBriefQueue.grantConsumeMessages(fn);
    execBriefQueue.grantSendMessages(fn); // requeue scoring
    documentsBucket.grantReadWrite(fn);
    mainTable.grantReadWriteData(fn);

    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ['*'],
      }),
    );

    return fn;
  }

  private addRoutes(args: { 
    samGovApiKeySecret: secretsmanager.ISecret, 
    execBriefQueue: any,
    linearApiKeySecret: secretsmanager.ISecret, 
  }) {
    const { samGovApiKeySecret, execBriefQueue, linearApiKeySecret } = args;

    // Prompt
    this.promptApi.addRoute('save-prompt/{scope}', 'POST', 'lambda/prompt/save-prompt.ts');
    this.promptApi.addRoute('get-prompts', 'GET', 'lambda/prompt/get-prompts.ts');

    // SAM.gov
    this.samgovApi.addRoute('/import-solicitation', 'POST', 'lambda/samgov/import-solicitation.ts', {
      SAM_GOV_API_KEY_SECRET_ID: samGovApiKeySecret.secretArn,
    });
    this.samgovApi.addRoute('/create-saved-search', 'POST', 'lambda/samgov/create-saved-search.ts', {
      SAM_GOV_API_KEY_SECRET_ID: samGovApiKeySecret.secretArn,
    });
    this.samgovApi.addRoute('/list-saved-search', 'GET', 'lambda/samgov/list-saved-search.ts');
    this.samgovApi.addRoute('/delete-saved-search/{id}', 'DELETE', 'lambda/samgov/delete-saved-search.ts');
    this.samgovApi.addRoute('/edit-saved-search/{id}', 'PATCH', 'lambda/samgov/edit-saved-search.ts');
    this.samgovApi.addRoute('/opportunities', 'POST', 'lambda/samgov/search-opportunities.ts', {
      SAM_GOV_API_KEY_SECRET_ID: samGovApiKeySecret.secretArn,
    });

    // Semantic
    this.semanticApi.addRoute('/search', 'POST', 'lambda/semanticsearch/search.ts');

    // Question
    this.questionApi.addRoute('/delete-question', 'DELETE', 'lambda/question/delete-question.ts');

    // User
    this.userApi.addRoute('/create-user', 'POST', 'lambda/user/create-user.ts');
    this.userApi.addRoute('/get-users', 'GET', 'lambda/user/get-users.ts');
    this.userApi.addRoute('/edit-user', 'PATCH', 'lambda/user/edit-user.ts');
    this.userApi.addRoute('/delete-user', 'DELETE', 'lambda/user/delete-user.ts');

    // Brief
    this.briefApi.addRoute('/init-executive-brief', 'POST', 'lambda/brief/init-executive-brief.ts', {
      EXEC_BRIEF_QUEUE_URL: execBriefQueue.queueUrl,
    });
    this.briefApi.addRoute('/generate-executive-brief-summary', 'POST', 'lambda/brief/generate-summary.ts', {
      EXEC_BRIEF_QUEUE_URL: execBriefQueue.queueUrl
    });
    this.briefApi.addRoute('/generate-executive-brief-deadlines', 'POST', 'lambda/brief/generate-deadlines.ts', {
      EXEC_BRIEF_QUEUE_URL: execBriefQueue.queueUrl,
    });
    this.briefApi.addRoute('/generate-executive-brief-contacts', 'POST', 'lambda/brief/generate-contacts.ts', {
      EXEC_BRIEF_QUEUE_URL: execBriefQueue.queueUrl,
    });
    this.briefApi.addRoute('/generate-executive-brief-requirements', 'POST', 'lambda/brief/generate-requirements.ts', {
      EXEC_BRIEF_QUEUE_URL: execBriefQueue.queueUrl,
    });
    this.briefApi.addRoute('/generate-executive-brief-risks', 'POST', 'lambda/brief/generate-risks.ts', {
      EXEC_BRIEF_QUEUE_URL: execBriefQueue.queueUrl,
    });
    this.briefApi.addRoute('/generate-executive-brief-scoring', 'POST', 'lambda/brief/generate-scoring.ts', {
      EXEC_BRIEF_QUEUE_URL: execBriefQueue.queueUrl,
    });
    this.briefApi.addRoute('/get-executive-brief-by-project', 'POST', 'lambda/brief/get-executive-brief-by-project.ts');
    this.briefApi.addRoute('/handle-linear-ticket', 'POST', 'lambda/brief/handle-linear-ticket.ts', {
      LINEAR_API_KEY_SECRET_ARN: linearApiKeySecret.secretArn,
    });
    this.briefApi.addRoute('/update-decision', 'POST', 'lambda/brief/update-decision.ts');

    // Deadlines
    this.deadlinesApi.addRoute('/get-deadlines', 'GET', 'lambda/deadlines/get-deadlines.ts');
    this.deadlinesApi.addRoute('/export-calendar', 'GET', 'lambda/deadlines/export-deadlines.ts');

    // Question file
    this.questionFileApi.addRoute('/start-question-pipeline', 'POST', 'lambda/question-file/start-question-pipeline.ts');
    this.questionFileApi.addRoute('/create-question-file', 'POST', 'lambda/question-file/create-question-file.ts');
    this.questionFileApi.addRoute('/get-question-file', 'GET', 'lambda/question-file/get-question-file.ts');
    this.questionFileApi.addRoute('/get-question-files', 'GET', 'lambda/question-file/get-question-files.ts');
    this.questionFileApi.addRoute('/delete-question-file', 'DELETE', 'lambda/question-file/delete-question-file.ts');

    // KB
    this.knowledgeBaseApi.addRoute('/create-knowledgebase', 'POST', 'lambda/knowledgebase/create-knowledgebase.ts');
    this.knowledgeBaseApi.addRoute('/delete-knowledgebase', 'DELETE', 'lambda/knowledgebase/delete-knowledgebase.ts');
    this.knowledgeBaseApi.addRoute('/edit-knowledgebase', 'PATCH', 'lambda/knowledgebase/edit-knowledgebase.ts');
    this.knowledgeBaseApi.addRoute('/get-knowledgebases', 'GET', 'lambda/knowledgebase/get-knowledgebases.ts');
    this.knowledgeBaseApi.addRoute('/get-knowledgebase', 'GET', 'lambda/knowledgebase/get-knowledgebase.ts');

    // Document
    this.documentApi.addRoute('/create-document', 'POST', 'lambda/document/create-document.ts');
    this.documentApi.addRoute('/edit-document', 'PATCH', 'lambda/document/edit-document.ts');
    this.documentApi.addRoute('/delete-document', 'DELETE', 'lambda/document/delete-document.ts');
    this.documentApi.addRoute('/get-documents', 'GET', 'lambda/document/get-documents.ts');
    this.documentApi.addRoute('/get-document', 'GET', 'lambda/document/get-document.ts');
    this.documentApi.addRoute('/start-document-pipeline', 'POST', 'lambda/document/start-document-pipeline.ts');

    // Org
    this.organizationApi.addRoute('/get-organizations', 'GET', 'lambda/organization/get-organizations.ts');
    this.organizationApi.addRoute('/create-organization', 'POST', 'lambda/organization/create-organization.ts');
    this.organizationApi.addRoute('/edit-organization/{id}', 'PATCH', 'lambda/organization/edit-organization.ts');
    this.organizationApi.addRoute('/get-organization/{id}', 'GET', 'lambda/organization/get-organization-by-id.ts');
    this.organizationApi.addRoute('/delete-organization', 'DELETE', 'lambda/organization/delete-organization.ts');

    // Project
    this.projectApi.addRoute('/get-projects', 'GET', 'lambda/project/get-projects.ts');
    this.projectApi.addRoute('/create-project', 'POST', 'lambda/project/create-project.ts');
    this.projectApi.addRoute('/get-project/{id}', 'GET', 'lambda/project/get-project-by-id.ts');
    this.projectApi.addRoute('/delete-project', 'DELETE', 'lambda/project/delete-project.ts');
    this.projectApi.addRoute('/get-questions/{id}', 'GET', 'lambda/project/get-questions.ts');

    // Presigned
    this.presignedUrlApi.addRoute('/presigned-url', 'POST', 'lambda/presigned/generate-presigned-url.ts');

    // Answer
    this.answerApi.addRoute('/get-answers/{id}', 'GET', 'lambda/answer/get-answers.ts');
    this.answerApi.addRoute('/save-answer', 'POST', 'lambda/answer/save-answer.ts');
    this.answerApi.addRoute('/generate-answer', 'POST', 'lambda/answer/generate-answer.ts');

    // Proposal
    this.proposalApi.addRoute('/generate-proposal', 'POST', 'lambda/proposal/generate-proposal.ts');
    this.proposalApi.addRoute('/get-proposals', 'GET', 'lambda/proposal/get-proposals.ts');
    this.proposalApi.addRoute('/get-proposal', 'GET', 'lambda/proposal/get-proposal.ts');
    this.proposalApi.addRoute('/save-proposal', 'POST', 'lambda/proposal/save-proposal.ts');
  }
}