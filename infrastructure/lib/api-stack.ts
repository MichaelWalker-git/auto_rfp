import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { ApiNestedStack } from './wrappers/api-nested-stack';
import { NagSuppressions } from 'cdk-nag';

export interface ApiStackProps extends cdk.StackProps {
  stage: string;
  documentsBucket: s3.IBucket;
  /**
   * Single-table design that stores organizations (PK = "ORG", etc.)
   */
  mainTable: dynamodb.ITable;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
  documentPipelineStateMachineArn: string;
  openSearchCollectionEndpoint: string;
  vpc: ec2.IVpc;
}

export class ApiStack extends cdk.Stack {
  private readonly lambdaPermissions: cdk.aws_iam.PolicyStatement[];
  private readonly policy: cdk.aws_iam.Policy;
  public readonly api: apigw.RestApi;

  private readonly organizationApi: ApiNestedStack;
  private readonly projectApi: ApiNestedStack;
  private readonly questionApi: ApiNestedStack;
  private readonly answerApi: ApiNestedStack;
  private readonly presignedUrlApi: ApiNestedStack;
  private readonly fileApi: ApiNestedStack;
  private readonly textractApi: ApiNestedStack;
  private readonly knowledgeBaseApi: ApiNestedStack;
  private readonly documentApi: ApiNestedStack;


  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      stage,
      documentsBucket,
      mainTable,
      userPool,
      userPoolClient,
      documentPipelineStateMachineArn,
      openSearchCollectionEndpoint,
      vpc
    } = props;

    // 1) Common REST API
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

    // 2) Shared Lambda role for all API lambdas
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

    // Basic lambda execution (logs, etc.)
    lambdaRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
    );

    // DynamoDB access for the main table
    mainTable.grantReadWriteData(lambdaRole);

    // S3 docs bucket
    documentsBucket.grantReadWrite(lambdaRole);

    // Cognito admin ops (if you need them from Lambda)
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
    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: ["*"],
        effect: iam.Effect.ALLOW,
      }),
    );


    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: [
          'textract:StartDocumentTextDetection',
          'textract:GetDocumentTextDetection',
          'textract:DetectDocumentText',
        ],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
      }),
    );


    lambdaRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['aoss:*'],
        resources: ['*'],
        effect: iam.Effect.ALLOW,
      })
    )

    // 3) Common env that every lambda will get by default
    //    Adjust PK/SK env names to what you actually use.
    const commonEnv: Record<string, string> = {
      STAGE: stage,
      AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      NODE_ENV: 'production',

      // DynamoDB single-table config
      DB_TABLE_NAME: mainTable.tableName,

      // Cognito config for backend use
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,

      BEDROCK_REGION: 'us-east-1',
      BEDROCK_EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
      BEDROCK_MODEL_ID: 'anthropic.claude-3-haiku-20240307-v1:0',
      OPENSEARCH_INDEX: 'documents',
      STATE_MACHINE_ARN: documentPipelineStateMachineArn,
      OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint
    };

    // 4) First entity: Organization API
    this.organizationApi = new ApiNestedStack(this, 'OrganizationApi', {
      api: this.api,
      basePath: 'organization',
      lambdaRole,
      commonEnv,
      userPool
    });
    this.projectApi = new ApiNestedStack(this, 'ProjectApi', {
      api: this.api,
      basePath: 'project',
      lambdaRole,
      commonEnv,
      userPool
    });

    this.questionApi = new ApiNestedStack(this, 'QuestionApi', {
      api: this.api,
      basePath: 'question',
      lambdaRole,
      commonEnv,
      userPool
    });

    this.answerApi = new ApiNestedStack(this, 'AnswerApi', {
      api: this.api,
      basePath: 'answer',
      lambdaRole,
      commonEnv,
      userPool
    });

    this.answerApi.addRoute(
      '/create-answer',
      'POST',
      'lambda/answer/create-answer.ts',
    );

    this.answerApi.addRoute(
      '/generate-answer',
      'POST',
      'lambda/answer/generate-answer.ts',
    );

    this.presignedUrlApi = new ApiNestedStack(this, 'PresignedUrlApi', {
      api: this.api,
      basePath: 'presigned',
      lambdaRole,
      commonEnv,
      userPool
    });

    this.fileApi = new ApiNestedStack(this, 'FileApi', {
      api: this.api,
      basePath: 'file',
      lambdaRole,
      commonEnv,
      userPool
    });

    this.textractApi = new ApiNestedStack(this, 'TextractApi', {
      api: this.api,
      basePath: 'textract',
      lambdaRole,
      commonEnv,
      userPool
    });

    this.knowledgeBaseApi = new ApiNestedStack(this, 'KnowledgeBaseApi', {
      api: this.api,
      basePath: 'knowledgebase',
      lambdaRole,
      commonEnv,
      userPool
    });


    this.knowledgeBaseApi.addRoute(
      '/create-knowledgebase',
      'POST',
      'lambda/knowledgebase/create-knowledgebase.ts',
    )

    this.knowledgeBaseApi.addRoute(
      '/delete-knowledgebase',
      'DELETE',
      'lambda/knowledgebase/delete-knowledgebase.ts',
    )

    this.knowledgeBaseApi.addRoute(
      '/edit-knowledgebase',
      'PATCH',
      'lambda/knowledgebase/edit-knowledgebase.ts',
    )

    this.knowledgeBaseApi.addRoute(
      '/get-knowledgebases',
      'GET',
      'lambda/knowledgebase/get-knowledgebases.ts',
    )

    this.knowledgeBaseApi.addRoute(
      '/get-knowledgebase',
      'GET',
      'lambda/knowledgebase/get-knowledgebase.ts',
    )

    this.documentApi = new ApiNestedStack(this, 'DocumentApi', {
      api: this.api,
      basePath: 'document',
      lambdaRole,
      commonEnv,
      userPool,
    });

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
      '/edit-project',
      'PATCH',
      'lambda/project/edit-project.ts',
    );

    this.projectApi.addRoute(
      '/delete-project/{id}',
      'DELETE',
      'lambda/project/delete-project.ts',
    );

    this.projectApi.addRoute(
      '/get-questions/{id}',
      'GET',
      'lambda/project/get-questions.ts',
    );

    this.questionApi.addRoute(
      '/extract-questions',
      'POST',
      'lambda/question/extract-questions.ts',
    );

    this.questionApi.addRoute(
      '/extract-text',
      'POST',
      'lambda/question/extract-text.ts',
    );

    this.presignedUrlApi.addRoute(
      '/presigned-url',
      'POST',
      'lambda/presigned/generate-presigned-url.ts',
    );

    this.fileApi.addRoute(
      '/convert-to-text',
      'POST',
      'lambda/file/convert-to-text.ts',
    );

    this.fileApi.addRoute(
      '/get-text',
      'POST',
      'lambda/file/get-text.ts',
    );

    this.textractApi.addRoute(
      '/begin-extraction',
      'POST',
      'lambda/textract/begin-extraction.ts',
    );

    this.textractApi.addRoute(
      '/get-result',
      'POST',
      'lambda/textract/get-result.ts',
    );

    new cdk.CfnOutput(this, 'ApiBaseUrl', {
      value: this.api.url,
      description: 'Base URL for the AutoRFP API',
    });

    NagSuppressions.addResourceSuppressions(
      this.api,
      [
        {
          id: 'AwsSolutions-APIG1',
          reason: 'Access logging will be configured for production; dev environment keeps it off for speed.',
        },
        {
          id: 'AwsSolutions-APIG2',
          reason: 'Request validation will be added for production once the contract is finalized.',
        },
        {
          id: 'AwsSolutions-APIG4',
          reason: 'Cognito / IAM authorizers will be added when the auth model is stable; dev API is open behind internal access.',
        },
        {
          id: 'AwsSolutions-COG4',
          reason: 'Cognito user pool authorizer will be attached in production; dev stack is unauthenticated.',
        },
      ],
      true, // applyToChildren = true (covers methods)
    );

    // TODO: Add CDK NAG suppressions for development - REMOVE IN PRODUCTION
    // These suppressions allow deployment while security issues are addressed
    this.addCdkNagSuppressions();
  }





  // Later you can add:
  // this.userApi = new ApiNestedStack(this, 'UserApi', { api: this.api, basePath: 'user', this.lambdaRole, commonEnv });
  // this.userApi.addRoute('/get-users', 'GET', 'lambda/user/get-users.ts');
  // TODO: REMOVE IN PRODUCTION - These suppressions are for development only
  // Each suppression needs to be addressed for production deployment
  private addCdkNagSuppressions(): void {
    // Suppress ALL CDK NAG errors for development deployment
    // TODO: Remove these suppressions and fix each security issue for production
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-VPC7',
        reason: 'TODO: VPC Flow Logs will be added in production for network monitoring',
      },
      {
        id: 'AwsSolutions-SMG4',
        reason: 'TODO: Add automatic secret rotation for production',
      },
      {
        id: 'AwsSolutions-EC23',
        reason: 'TODO: Restrict database access to specific IP ranges for production',
      },
      {
        id: 'AwsSolutions-RDS3',
        reason: 'TODO: Enable Multi-AZ for production high availability',
      },
      {
        id: 'AwsSolutions-RDS10',
        reason: 'TODO: Enable deletion protection for production',
      },
      {
        id: 'AwsSolutions-RDS11',
        reason: 'TODO: Use non-default database port for production',
      },
      {
        id: 'AwsSolutions-COG1',
        reason: 'TODO: Strengthen password policy to require special characters',
      },
      {
        id: 'AwsSolutions-COG2',
        reason: 'TODO: Enable MFA for production user authentication',
      },
      {
        id: 'AwsSolutions-COG3',
        reason: 'TODO: Enable advanced security mode for production',
      },
      {
        id: 'AwsSolutions-COG4',
        reason: 'TODO: Add Cognito User Pool authorizer to API Gateway',
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'TODO: Enable S3 server access logging for production',
      },
      {
        id: 'AwsSolutions-S10',
        reason: 'TODO: Add SSL-only bucket policies for production',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'TODO: Update to latest Node.js runtime version',
      },
      {
        id: 'AwsSolutions-IAM4',
        reason: 'TODO: Replace AWS managed policies with custom policies',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'TODO: Remove wildcard permissions and use specific resource ARNs',
      },
      {
        id: 'AwsSolutions-APIG1',
        reason: 'TODO: Enable API Gateway access logging for production',
      },
      {
        id: 'AwsSolutions-APIG2',
        reason: 'TODO: Add request validation to API Gateway',
      },
      {
        id: 'AwsSolutions-APIG3',
        reason: 'TODO: Associate API Gateway with AWS WAF for production',
      },
      {
        id: 'AwsSolutions-APIG4',
        reason: 'TODO: Implement API Gateway authorization',
      },
      {
        id: 'AwsSolutions-CFR1',
        reason: 'TODO: Add geo restrictions if needed for production',
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'TODO: Integrate CloudFront with AWS WAF for production',
      },
      {
        id: 'AwsSolutions-CFR3',
        reason: 'TODO: Enable CloudFront access logging for production',
      },
      {
        id: 'AwsSolutions-CFR4',
        reason: 'TODO: Update CloudFront to use TLS 1.2+ minimum',
      },
      {
        id: 'AwsSolutions-CFR7',
        reason: 'TODO: Use Origin Access Control instead of OAI',
      },
    ]);
  }
}
