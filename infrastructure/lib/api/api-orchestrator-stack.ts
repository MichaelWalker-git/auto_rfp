import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

import { ApiFacadeStack } from './api-facade-stack';
import { ApiSharedInfraStack } from './api-shared-infra-stack';
import { ApiDomainRoutesStack } from './api-domain-resource-stack';
import { foiaDomain } from './routes/foia.routes';
import { debriefingDomain } from './routes/debriefing.routes';
import { answerDomain } from './routes/answer.routes';
import { organizationDomain } from './routes/organization.routes';
import { presignedDomain } from './routes/presigned.routes';
import { knowledgebaseDomain } from './routes/knowledgebase.routes';
import { documentDomain } from './routes/document.routes';
import { questionfileDomain } from './routes/questionfile.routes';
import { proposalDomain } from './routes/proposal.routes';
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
import { linearRoutes } from './routes/linear-routes';

export interface ApiOrchestratorStackProps extends cdk.StackProps {
  stage: string;
  userPool: cognito.IUserPool;
  mainTable: dynamodb.ITable;
  documentsBucket: s3.IBucket;
  execBriefQueue?: sqs.IQueue;
  samGovApiKeySecret?: secretsmanager.ISecret;
  linearApiKeySecret?: secretsmanager.ISecret;
  documentPipelineStateMachineArn: string;
  questionPipelineStateMachineArn: string;
  sentryDNS: string;
  pineconeApiKey: string;
}

/**
 * Orchestrates all API infrastructure:
 * 1. Creates the REST API facade
 * 2. Sets up shared Lambda infrastructure
 * 3. Instantiates domain-specific route stacks
 */
export class ApiOrchestratorStack extends cdk.Stack {
  public readonly restApiId: string;
  public readonly rootResourceId: string;
  public readonly commonLambdaRoleArn: string;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiOrchestratorStackProps) {
    super(scope, id, props);

    const {
      stage,
      userPool,
      mainTable,
      documentsBucket,
      execBriefQueue,
      samGovApiKeySecret,
      linearApiKeySecret,
      documentPipelineStateMachineArn,
      questionPipelineStateMachineArn,
      sentryDNS,
      pineconeApiKey,
    } = props;

    // 1. Create API facade (REST API Gateway)
    const facadeStack = new ApiFacadeStack(this, 'ApiFacade', {
      stage,
      userPoolId: userPool.userPoolId,
      env: props.env,
    });

    this.api = facadeStack.api;
    this.restApiId = facadeStack.api.restApiId;
    this.rootResourceId = facadeStack.api.restApiRootResourceId;

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
      env: props.env,
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

    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [documentPipelineStateMachineArn, questionPipelineStateMachineArn],
      }),
    );

    // Grant access to secrets if provided
    if (samGovApiKeySecret) {
      samGovApiKeySecret.grantRead(sharedInfraStack.commonLambdaRole);
    }
    
    // Grant Lambda role access to Secrets Manager for SAM.gov API keys
    sharedInfraStack.commonLambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'secretsmanager:GetSecretValue',
          'secretsmanager:PutSecretValue',
          'secretsmanager:DeleteSecret',
          'secretsmanager:CreateSecret',
        ],
        resources: [`arn:aws:secretsmanager:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:secret:samgov-api-key-*`],
      }),
    );
    if (linearApiKeySecret) {
      linearApiKeySecret.grantRead(sharedInfraStack.commonLambdaRole);
    }
    if (execBriefQueue) {
      execBriefQueue.grantSendMessages(sharedInfraStack.commonLambdaRole);
    }

    // 3. Instantiate domain-specific route stacks
    // Each domain gets its own stack to manage CloudFormation resource limits

    new ApiDomainRoutesStack(this, 'OrganizationRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: organizationDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'AnswerRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: answerDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'PresignedRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: presignedDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'KnowledgebaseRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: knowledgebaseDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'DocumentRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: documentDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'QuestionfileRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: questionfileDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'ProposalRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: proposalDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'UserRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: userDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'QuestionRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: questionDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'SemanticRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: semanticDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'DeadlinesRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: deadlinesDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'OpportunityRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: opportunityDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'ExportRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: exportDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'ContentLibraryRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: contentlibraryDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'ProjectOutcomeRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: projectoutcomeDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'FoiaRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: foiaDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'DebriefingRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: debriefingDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'ProjectsRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: projectsDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'PromptRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: promptDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'SamgovRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: samgovDomain(),
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new ApiDomainRoutesStack(this, 'LinearRoutes', {
      restApiId: this.restApiId,
      rootResourceId: this.rootResourceId,
      userPoolId: userPool.userPoolId,
      lambdaRoleArn: this.commonLambdaRoleArn,
      commonEnv: sharedInfraStack.commonEnv,
      domain: linearRoutes,
      authorizer: facadeStack.authorizer,
      env: props.env,
    });

    new cdk.CfnOutput(this, 'RestApiId', {
      value: this.restApiId,
    });

    new cdk.CfnOutput(this, 'RootResourceId', {
      value: this.rootResourceId,
    });

    new cdk.CfnOutput(this, 'CommonLambdaRoleArn', {
      value: this.commonLambdaRoleArn,
    });
  }
}