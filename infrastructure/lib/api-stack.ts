import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { ApiNestedStack } from './wrappers/api-nested-stack';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';

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
  private readonly lambdaPermissions: cdk.aws_iam.PolicyStatement[];
  private readonly policy: cdk.aws_iam.Policy;
  public readonly api: apigw.RestApi;

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
      sentryDNS
    } = props;

    this.api = new apigw.RestApi(this, 'AutoRfpApi', {
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
    const lambdaRole = new iam.Role(this, 'CommonLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      roleName: `auto-rfp-api-lambda-role-${stage}`,
    });

    this.lambdaPermissions = [
      new cdk.aws_iam.PolicyStatement({
        actions: ['execute-api:Invoke'],
        resources: ['*'],
        effect: cdk.aws_iam.Effect.ALLOW,
      }),
      new cdk.aws_iam.PolicyStatement({
        actions: ['s3:*'],
        resources: ['*'],
        effect: cdk.aws_iam.Effect.ALLOW,
      }),
      new cdk.aws_iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminDeleteUser',
          'cognito-idp:AdminGetUser',
        ],
        resources: [props.userPool.userPoolArn],
        effect: cdk.aws_iam.Effect.ALLOW,
      }),
      new cdk.aws_iam.PolicyStatement({
        actions: ['logs:*'],
        resources: ['*'],
        effect: cdk.aws_iam.Effect.ALLOW,
      }),
      new cdk.aws_iam.PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: ['*'],
        effect: cdk.aws_iam.Effect.ALLOW,
      }),
      new cdk.aws_iam.PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [`${process.env.BB_PROD_CREDENTIALS_ARN || '*'}`],
        effect: cdk.aws_iam.Effect.ALLOW,
      }),
      new iam.PolicyStatement({
        actions: ['es:ESHttpPost', 'es:ESHttpPut', 'es:ESHttpGet'],
        resources: [
          'arn:aws:es:us-west-2:039885961427:domain/prodopensearchd-lxtzjp7drbvs/*',
        ],
      }),
      new iam.PolicyStatement({
        actions: ['states:StartExecution'],
        resources: [documentPipelineStateMachineArn],
        effect: cdk.aws_iam.Effect.ALLOW,
      })
    ];

    this.policy = new cdk.aws_iam.Policy(this, 'LambdaPolicy', {
      statements: this.lambdaPermissions,
    });

    lambdaRole.attachInlinePolicy(this.policy);

    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );
    mainTable.grantReadWriteData(lambdaRole);
    documentsBucket.grantReadWrite(lambdaRole);

    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'cognito-idp:AdminInitiateAuth',
          'cognito-idp:AdminCreateUser',
          'cognito-idp:AdminSetUserPassword',
          'cognito-idp:AdminUpdateUserAttributes',
          'cognito-idp:AdminGetUser',
          'cognito-idp:ListUsers',
        ],
        resources: [userPool.userPoolArn],
        effect: iam.Effect.ALLOW,
      }),
    );

    // Bedrock (optional, keep if you use it)
    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
      resources: ['*'],
      effect: iam.Effect.ALLOW,
    }));

    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'textract:StartDocumentTextDetection',
        'textract:GetDocumentTextDetection',
        'textract:DetectDocumentText',
      ],
      resources: ['*'],
      effect: iam.Effect.ALLOW,
    }));

    lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['states:StartExecution'],
      resources: ['*'],
      effect: iam.Effect.ALLOW,
    }));

    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['aoss:*'],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
      })
    );

    const commonEnv: Record<string, string> = {
      STAGE: stage,
      AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      NODE_ENV: 'production',
      DB_TABLE_NAME: mainTable.tableName,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
      REGION: 'us-east-1',
      BEDROCK_REGION: 'us-east-1',
      BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
      BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
      OPENSEARCH_INDEX: 'documents',
      STATE_MACHINE_ARN: documentPipelineStateMachineArn,
      QUESTION_PIPELINE_STATE_MACHINE_ARN: questionPipelineStateMachineArn,
      OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint,
      SENTRY_DSN: sentryDNS,
      SENTRY_ENVIRONMENT: stage,
    };
    const localKey = process.env.SAM_GOV_API_KEY;
    const samGovApiKeySecret = localKey
      ? new secretsmanager.Secret(this, `SamGovApiKeySecret-${stage}`, {
        secretName: `auto-rfp/${stage}/samgov/apiKey`,
        secretStringValue: cdk.SecretValue.unsafePlainText(localKey),
      })
      : new secretsmanager.Secret(this, `SamGovApiKeySecret-${stage}`, {
        secretName: `auto-rfp/${stage}/samgov/apiKey`,
        generateSecretString: {
          passwordLength: 32,
          excludePunctuation: true,
        },
      });

    const runSavedSearchesFn = new lambdaNodejs.NodejsFunction(this, `RunSavedSearches-${stage}`, {
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
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        QUESTION_PIPELINE_STATE_MACHINE_ARN: questionPipelineStateMachineArn,
      },
      bundling: {
        externalModules: ['aws-sdk'],
      },
    });

    new logs.LogRetention(this, `RunSavedSearchesLogs-${stage}`, {
      logGroupName: `/aws/lambda/${runSavedSearchesFn.functionName}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const runSavedSearchesRule = new events.Rule(this, `RunSavedSearchesRule-${stage}`, {
      ruleName: `auto-rfp-${stage}-run-saved-searches-hourly`,
      description: 'Hourly runner to execute SAM saved searches for all orgs',
      schedule: events.Schedule.rate(cdk.Duration.hours(1)),
    });

    runSavedSearchesRule.addTarget(
      new targets.LambdaFunction(runSavedSearchesFn, {
        event: events.RuleTargetInput.fromObject({
          dryRun: false,
        }),
      }),
    );

    runSavedSearchesFn.addPermission(`AllowEventBridgeInvoke-${stage}`, {
      principal: new iam.ServicePrincipal('events.amazonaws.com'),
      sourceArn: runSavedSearchesRule.ruleArn,
    });

    samGovApiKeySecret.grantRead(lambdaRole);

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, `${id}Authorizer`, {
      cognitoUserPools: [props.userPool],
    });

    const createNestedStack = (basePath: string) => {
      return new ApiNestedStack(this, `${basePath}API`, {
          api: this.api,
          basePath: basePath,
          lambdaRole,
          commonEnv,
          userPool,
          authorizer
        }
      );
    };

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

    this.promptApi.addRoute(
      'save-prompt/{scope}',
      'POST',
      'lambda/prompt/save-prompt.ts',
    )

    this.promptApi.addRoute(
      'get-prompts',
      'GET',
      'lambda/prompt/get-prompts.ts',
    )

    this.samgovApi.addRoute(
      '/import-solicitation',
      'POST',
      'lambda/samgov/import-solicitation.ts',
      {
        SAM_GOV_API_KEY_SECRET_ID: samGovApiKeySecret.secretArn,
      }
    );

    this.samgovApi.addRoute(
      '/create-saved-search',
      'POST',
      'lambda/samgov/create-saved-search.ts',
      {
        SAM_GOV_API_KEY_SECRET_ID: samGovApiKeySecret.secretArn,
      }
    );

    this.samgovApi.addRoute(
      '/list-saved-search',
      'GET',
      'lambda/samgov/list-saved-search.ts',
    );

    this.samgovApi.addRoute(
      '/delete-saved-search/{id}',
      'DELETE',
      'lambda/samgov/delete-saved-search.ts',
    );

    this.samgovApi.addRoute(
      '/edit-saved-search/{id}',
      'PATCH',
      'lambda/samgov/edit-saved-search.ts',
    );

    this.samgovApi.addRoute(
      '/opportunities',
      'POST',
      'lambda/samgov/search-opportunities.ts',
      {
        SAM_GOV_API_KEY_SECRET_ID: samGovApiKeySecret.secretArn,
      }
    );

    this.semanticApi.addRoute(
      '/search',
      'POST',
      'lambda/semanticsearch/search.ts'
    );

    this.questionApi.addRoute(
      '/delete-question',
      'DELETE',
      'lambda/question/delete-question.ts'
    );

    this.userApi.addRoute(
      '/create-user',
      'POST',
      'lambda/user/create-user.ts'
    );

    this.userApi.addRoute(
      '/get-users',
      'GET',
      'lambda/user/get-users.ts'
    );

    this.userApi.addRoute(
      '/edit-user',
      'PATCH',
      'lambda/user/edit-user.ts'
    );

    this.userApi.addRoute(
      '/delete-user',
      'DELETE',
      'lambda/user/delete-user.ts'
    );

    this.briefApi.addRoute(
      '/init-executive-brief',
      'POST',
      'lambda/brief/init-executive-brief.ts',
    );

    this.briefApi.addRoute(
      '/generate-executive-brief-summary',
      'POST',
      'lambda/brief/generate-summary.ts',
    );

    this.briefApi.addRoute(
      '/generate-executive-brief-deadlines',
      'POST',
      'lambda/brief/generate-deadlines.ts',
    );

    this.briefApi.addRoute(
      '/generate-executive-brief-contacts',
      'POST',
      'lambda/brief/generate-contacts.ts',
    );

    this.briefApi.addRoute(
      '/generate-executive-brief-requirements',
      'POST',
      'lambda/brief/generate-requirements.ts',
    );

    this.briefApi.addRoute(
      '/generate-executive-brief-risks',
      'POST',
      'lambda/brief/generate-risks.ts',
    );

    this.briefApi.addRoute(
      '/generate-executive-brief-scoring',
      'POST',
      'lambda/brief/generate-scoring.ts',
    );

    this.briefApi.addRoute(
      '/get-executive-brief-by-project',
      'POST',
      'lambda/brief/get-executive-brief-by-project.ts',
    );

    this.deadlinesApi.addRoute(
      '/get-deadlines',
      'GET',
      'lambda/deadlines/get-deadlines.ts',
    );

    this.deadlinesApi.addRoute(
      '/export-calendar',
      'GET',
      'lambda/deadlines/export-deadlines.ts',
    );

    this.questionFileApi.addRoute(
      '/start-question-pipeline',
      'POST',
      'lambda/question-file/start-question-pipeline.ts',
    );

    this.questionFileApi.addRoute(
      '/create-question-file',
      'POST',
      'lambda/question-file/create-question-file.ts',
    );

    this.questionFileApi.addRoute(
      '/get-question-file',
      'GET',
      'lambda/question-file/get-question-file.ts',
    );

    this.questionFileApi.addRoute(
      '/get-question-files',
      'GET',
      'lambda/question-file/get-question-files.ts',
    );

    this.questionFileApi.addRoute(
      '/delete-question-file',
      'DELETE',
      'lambda/question-file/delete-question-file.ts',
    );

    this.knowledgeBaseApi.addRoute(
      '/create-knowledgebase',
      'POST',
      'lambda/knowledgebase/create-knowledgebase.ts',
    );

    this.knowledgeBaseApi.addRoute(
      '/delete-knowledgebase',
      'DELETE',
      'lambda/knowledgebase/delete-knowledgebase.ts',
    );

    this.knowledgeBaseApi.addRoute(
      '/edit-knowledgebase',
      'PATCH',
      'lambda/knowledgebase/edit-knowledgebase.ts',
    );

    this.knowledgeBaseApi.addRoute(
      '/get-knowledgebases',
      'GET',
      'lambda/knowledgebase/get-knowledgebases.ts',
    );

    this.knowledgeBaseApi.addRoute(
      '/get-knowledgebase',
      'GET',
      'lambda/knowledgebase/get-knowledgebase.ts',
    );

    this.documentApi.addRoute(
      '/create-document',
      'POST',
      'lambda/document/create-document.ts',
    );

    this.documentApi.addRoute(
      '/edit-document',
      'PATCH',
      'lambda/document/edit-document.ts',
    );

    this.documentApi.addRoute(
      '/delete-document',
      'DELETE',
      'lambda/document/delete-document.ts',
    );

    this.documentApi.addRoute(
      '/get-documents',
      'GET',
      'lambda/document/get-documents.ts',
    );

    this.documentApi.addRoute(
      '/get-document',
      'GET',
      'lambda/document/get-document.ts',
    );

    this.documentApi.addRoute(
      '/start-document-pipeline',
      'POST',
      'lambda/document/start-document-pipeline.ts',
    );


    this.organizationApi.addRoute(
      '/get-organizations',
      'GET',
      'lambda/organization/get-organizations.ts',
    );

    this.organizationApi.addRoute(
      '/create-organization',
      'POST',
      'lambda/organization/create-organization.ts',
    );

    this.organizationApi.addRoute(
      '/edit-organization/{id}',
      'PATCH',
      'lambda/organization/edit-organization.ts',
    );

    this.organizationApi.addRoute(
      '/get-organization/{id}',
      'GET',
      'lambda/organization/get-organization-by-id.ts',
    );

    this.organizationApi.addRoute(
      '/delete-organization',
      'DELETE',
      'lambda/organization/delete-organization.ts',
    );

    this.projectApi.addRoute(
      '/get-projects',
      'GET',
      'lambda/project/get-projects.ts',
    );

    this.projectApi.addRoute(
      '/create-project',
      'POST',
      'lambda/project/create-project.ts',
    );

    this.projectApi.addRoute(
      '/get-project/{id}',
      'GET',
      'lambda/project/get-project-by-id.ts',
    );

    this.projectApi.addRoute(
      '/delete-project',
      'DELETE',
      'lambda/project/delete-project.ts',
    );

    this.projectApi.addRoute(
      '/get-questions/{id}',
      'GET',
      'lambda/project/get-questions.ts',
    );

    this.presignedUrlApi.addRoute(
      '/presigned-url',
      'POST',
      'lambda/presigned/generate-presigned-url.ts',
    );
    this.answerApi.addRoute(
      '/get-answers/{id}',
      'GET',
      'lambda/answer/get-answers.ts',
    );

    this.answerApi.addRoute(
      '/create-answer',
      'POST',
      'lambda/answer/create-answer.ts',
    );

    this.answerApi.addRoute(
      '/save-answer',
      'POST',
      'lambda/answer/save-answer.ts',
    );

    this.answerApi.addRoute(
      '/generate-answer',
      'POST',
      'lambda/answer/generate-answer.ts',
    );

    this.proposalApi.addRoute(
      '/generate-proposal',
      'POST',
      'lambda/proposal/generate-proposal.ts',
    );

    this.proposalApi.addRoute(
      '/get-proposals',
      'GET',
      'lambda/proposal/get-proposals.ts',
    );

    this.proposalApi.addRoute(
      '/get-proposal',
      'GET',
      'lambda/proposal/get-proposal.ts',
    );

    this.proposalApi.addRoute(
      '/save-proposal',
      'POST',
      'lambda/proposal/save-proposal.ts',
    );

    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: this.api.url,
      description: 'Base URL for the AutoRFP API',
    });
  }
}
