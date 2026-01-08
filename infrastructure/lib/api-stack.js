"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const apigw = __importStar(require("aws-cdk-lib/aws-apigateway"));
const api_nested_stack_1 = require("./wrappers/api-nested-stack");
const cdk_nag_1 = require("cdk-nag");
class ApiStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { stage, documentsBucket, mainTable, userPool, userPoolClient, documentPipelineStateMachineArn, questionPipelineStateMachineArn, openSearchCollectionEndpoint, vpc } = props;
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
        lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
        // DynamoDB access for the main table
        mainTable.grantReadWriteData(lambdaRole);
        // S3 docs bucket
        documentsBucket.grantReadWrite(lambdaRole);
        // Cognito admin ops (if you need them from Lambda)
        lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
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
        }));
        // Bedrock (optional, keep if you use it)
        lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: ["*"],
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
        lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['aoss:*'],
            resources: ['*'],
            effect: iam.Effect.ALLOW,
        }));
        // SSM Parameter Store access for Bedrock API key
        lambdaRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['ssm:GetParameter'],
            resources: [
                `arn:aws:ssm:${ApiStack.BEDROCK_REGION}:${cdk.Aws.ACCOUNT_ID}:parameter/auto-rfp/bedrock/api-key`
            ],
            effect: iam.Effect.ALLOW,
        }));
        // 3) Common env that every lambda will get by default
        //    Adjust PK/SK env names to what you actually use.
        const commonEnv = {
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
            BEDROCK_API_KEY_SSM_PARAM: '/auto-rfp/bedrock/api-key',
            OPENSEARCH_INDEX: 'documents',
            STATE_MACHINE_ARN: documentPipelineStateMachineArn,
            QUESTION_PIPELINE_STATE_MACHINE_ARN: questionPipelineStateMachineArn,
            OPENSEARCH_ENDPOINT: openSearchCollectionEndpoint
        };
        // 4) First entity: Organization API
        this.organizationApi = new api_nested_stack_1.ApiNestedStack(this, 'OrganizationApi', {
            api: this.api,
            basePath: 'organization',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.projectApi = new api_nested_stack_1.ApiNestedStack(this, 'ProjectApi', {
            api: this.api,
            basePath: 'project',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.questionApi = new api_nested_stack_1.ApiNestedStack(this, 'QuestionApi', {
            api: this.api,
            basePath: 'question',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.answerApi = new api_nested_stack_1.ApiNestedStack(this, 'AnswerApi', {
            api: this.api,
            basePath: 'answer',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.presignedUrlApi = new api_nested_stack_1.ApiNestedStack(this, 'PresignedUrlApi', {
            api: this.api,
            basePath: 'presigned',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.fileApi = new api_nested_stack_1.ApiNestedStack(this, 'FileApi', {
            api: this.api,
            basePath: 'file',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.textractApi = new api_nested_stack_1.ApiNestedStack(this, 'TextractApi', {
            api: this.api,
            basePath: 'textract',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.knowledgeBaseApi = new api_nested_stack_1.ApiNestedStack(this, 'KnowledgeBaseApi', {
            api: this.api,
            basePath: 'knowledgebase',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.questionFileApi = new api_nested_stack_1.ApiNestedStack(this, 'QuestionFileApi', {
            api: this.api,
            basePath: 'questionfile',
            lambdaRole,
            commonEnv,
            userPool
        });
        this.questionFileApi.addRoute('/start-question-pipeline', 'POST', 'lambda/question-file/start-question-pipeline.ts');
        this.questionFileApi.addRoute('/create-question-file', 'POST', 'lambda/question-file/create-question-file.ts');
        this.questionFileApi.addRoute('/get-question-file', 'GET', 'lambda/question-file/get-question-file.ts');
        this.knowledgeBaseApi.addRoute('/create-knowledgebase', 'POST', 'lambda/knowledgebase/create-knowledgebase.ts');
        this.knowledgeBaseApi.addRoute('/delete-knowledgebase', 'DELETE', 'lambda/knowledgebase/delete-knowledgebase.ts');
        this.knowledgeBaseApi.addRoute('/edit-knowledgebase', 'PATCH', 'lambda/knowledgebase/edit-knowledgebase.ts');
        this.knowledgeBaseApi.addRoute('/get-knowledgebases', 'GET', 'lambda/knowledgebase/get-knowledgebases.ts');
        this.knowledgeBaseApi.addRoute('/get-knowledgebase', 'GET', 'lambda/knowledgebase/get-knowledgebase.ts');
        this.documentApi = new api_nested_stack_1.ApiNestedStack(this, 'DocumentApi', {
            api: this.api,
            basePath: 'document',
            lambdaRole,
            commonEnv,
            userPool,
        });
        this.documentApi.addRoute('/create-document', 'POST', 'lambda/document/create-document.ts');
        this.documentApi.addRoute('/edit-document', 'PATCH', 'lambda/document/edit-document.ts');
        this.documentApi.addRoute('/delete-document', 'DELETE', 'lambda/document/delete-document.ts');
        this.documentApi.addRoute('/get-documents', 'GET', 'lambda/document/get-documents.ts');
        this.documentApi.addRoute('/get-document', 'GET', 'lambda/document/get-document.ts');
        this.documentApi.addRoute('/start-document-pipeline', 'POST', 'lambda/document/start-document-pipeline.ts');
        this.organizationApi.addRoute('/get-organizations', 'GET', 'lambda/organization/get-organizations.ts');
        this.organizationApi.addRoute('/create-organization', 'POST', 'lambda/organization/create-organization.ts');
        this.organizationApi.addRoute('/edit-organization/{id}', 'PATCH', 'lambda/organization/edit-organization.ts');
        this.organizationApi.addRoute('/get-organization/{id}', 'GET', 'lambda/organization/get-organization-by-id.ts');
        this.organizationApi.addRoute('/delete-organization', 'DELETE', 'lambda/organization/delete-organization.ts');
        this.projectApi.addRoute('/get-projects', 'GET', 'lambda/project/get-projects.ts');
        this.projectApi.addRoute('/create-project', 'POST', 'lambda/project/create-project.ts');
        this.projectApi.addRoute('/get-project/{id}', 'GET', 'lambda/project/get-project-by-id.ts');
        this.projectApi.addRoute('/edit-project', 'PATCH', 'lambda/project/edit-project.ts');
        this.projectApi.addRoute('/delete-project/{id}', 'DELETE', 'lambda/project/delete-project.ts');
        this.projectApi.addRoute('/get-questions/{id}', 'GET', 'lambda/project/get-questions.ts');
        this.questionApi.addRoute('/extract-questions', 'POST', 'lambda/question/extract-questions.ts');
        this.questionApi.addRoute('/extract-text', 'POST', 'lambda/question/extract-text.ts');
        this.presignedUrlApi.addRoute('/presigned-url', 'POST', 'lambda/presigned/generate-presigned-url.ts');
        this.fileApi.addRoute('/convert-to-text', 'POST', 'lambda/file/convert-to-text.ts');
        this.fileApi.addRoute('/get-text', 'POST', 'lambda/file/get-text.ts');
        this.textractApi.addRoute('/begin-extraction', 'POST', 'lambda/textract/begin-extraction.ts');
        this.answerApi.addRoute('/get-answers/{id}', 'GET', 'lambda/answer/get-answers.ts');
        this.answerApi.addRoute('/create-answer', 'POST', 'lambda/answer/create-answer.ts');
        this.answerApi.addRoute('/save-answer', 'POST', 'lambda/answer/save-answer.ts');
        this.answerApi.addRoute('/generate-answer', 'POST', 'lambda/answer/generate-answer.ts');
        this.textractApi.addRoute('/get-result', 'POST', 'lambda/textract/get-result.ts');
        new cdk.CfnOutput(this, 'ApiBaseUrl', {
            value: this.api.url,
            description: 'Base URL for the AutoRFP API',
        });
        cdk_nag_1.NagSuppressions.addResourceSuppressions(this.api, [
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
        ], true);
        // TODO: Add CDK NAG suppressions for development - REMOVE IN PRODUCTION
        // These suppressions allow deployment while security issues are addressed
        this.addCdkNagSuppressions();
    }
    // Later you can add:
    // this.userApi = new ApiNestedStack(this, 'UserApi', { api: this.api, basePath: 'user', this.lambdaRole, commonEnv });
    // this.userApi.addRoute('/get-users', 'GET', 'lambda/user/get-users.ts');
    // TODO: REMOVE IN PRODUCTION - These suppressions are for development only
    // Each suppression needs to be addressed for production deployment
    addCdkNagSuppressions() {
        // Suppress ALL CDK NAG errors for development deployment
        // TODO: Remove these suppressions and fix each security issue for production
        cdk_nag_1.NagSuppressions.addStackSuppressions(this, [
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
exports.ApiStack = ApiStack;
ApiStack.BEDROCK_REGION = 'us-east-1';
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiYXBpLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQyx5REFBMkM7QUFDM0Msa0VBQW9EO0FBTXBELGtFQUE2RDtBQUM3RCxxQ0FBMEM7QUFpQjFDLE1BQWEsUUFBUyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBa0JyQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQW9CO1FBQzVELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFDSixLQUFLLEVBQ0wsZUFBZSxFQUNmLFNBQVMsRUFDVCxRQUFRLEVBQ1IsY0FBYyxFQUNkLCtCQUErQixFQUMvQiwrQkFBK0IsRUFDL0IsNEJBQTRCLEVBQzVCLEdBQUcsRUFDSixHQUFHLEtBQUssQ0FBQztRQUVWLHFCQUFxQjtRQUNyQixJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksS0FBSyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQy9DLFdBQVcsRUFBRSxnQkFBZ0IsS0FBSyxHQUFHO1lBQ3JDLFdBQVcsRUFBRSxxQkFBcUI7WUFDbEMsYUFBYSxFQUFFO2dCQUNiLFNBQVMsRUFBRSxLQUFLO2dCQUNoQixjQUFjLEVBQUUsSUFBSTtnQkFDcEIsWUFBWSxFQUFFLEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJO2dCQUMzQyxnQkFBZ0IsRUFBRSxJQUFJO2FBQ3ZCO1lBQ0QsMkJBQTJCLEVBQUU7Z0JBQzNCLFlBQVksRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLFdBQVc7Z0JBQ3BDLFlBQVksRUFBRSxLQUFLLENBQUMsSUFBSSxDQUFDLFdBQVc7Z0JBQ3BDLFlBQVksRUFBRTtvQkFDWixjQUFjO29CQUNkLGVBQWU7b0JBQ2YsWUFBWTtvQkFDWixXQUFXO29CQUNYLHNC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YUFDbEU7WUFDRDtnQkFDRSxFQUFFLEVBQUUsb0JBQW9CO2dCQUN4QixNQUFNLEVBQUUsMkNBQTJDO2FBQ3BEO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLHFEQUFxRDthQUM5RDtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSx3REFBd0Q7YUFDakU7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsdURBQXVEO2FBQ2hFO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLGlEQUFpRDthQUMxRDtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxnREFBZ0Q7YUFDekQ7U0FDRixDQUFDLENBQUM7SUFDTCxDQUFDOztBQXJwQkgsNEJBc3BCQztBQWxwQnlCLHVCQUFjLEdBQUcsV0FBVyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGFwaWd3IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcbmltcG9ydCAqIGFzIGR5bmFtb2RiIGZyb20gJ2F3cy1jZGstbGliL2F3cy1keW5hbW9kYic7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCB7IEFwaU5lc3RlZFN0YWNrIH0gZnJvbSAnLi93cmFwcGVycy9hcGktbmVzdGVkLXN0YWNrJztcbmltcG9ydCB7IE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEFwaVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIHN0YWdlOiBzdHJpbmc7XG4gIGRvY3VtZW50c0J1Y2tldDogczMuSUJ1Y2tldDtcbiAgLyoqXG4gICAqIFNpbmdsZS10YWJsZSBkZXNpZ24gdGhhdCBzdG9yZXMgb3JnYW5pemF0aW9ucyAoUEsgPSBcIk9SR1wiLCBldGMuKVxuICAgKi9cbiAgbWFpblRhYmxlOiBkeW5hbW9kYi5JVGFibGU7XG4gIHVzZXJQb29sOiBjb2duaXRvLklVc2VyUG9vbDtcbiAgdXNlclBvb2xDbGllbnQ6IGNvZ25pdG8uSVVzZXJQb29sQ2xpZW50O1xuICBkb2N1bWVudFBpcGVsaW5lU3RhdGVNYWNoaW5lQXJuOiBzdHJpbmc7XG4gIHF1ZXN0aW9uUGlwZWxpbmVTdGF0ZU1hY2hpbmVBcm46IHN0cmluZztcbiAgb3BlblNlYXJjaENvbGxlY3Rpb25FbmRwb2ludDogc3RyaW5nO1xuICB2cGM6IGVjMi5JVnBjO1xufVxuXG5leHBvcnQgY2xhc3MgQXBpU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwcml2YXRlIHJlYWRvbmx5IGxhbWJkYVBlcm1pc3Npb25zOiBjZGsuYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnRbXTtcbiAgcHJpdmF0ZSByZWFkb25seSBwb2xpY3k6IGNkay5hd3NfaWFtLlBvbGljeTtcbiAgcHVibGljIHJlYWRvbmx5IGFwaTogYXBpZ3cuUmVzdEFwaTtcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgQkVEUk9DS19SRUdJT04gPSAndXMtZWFzdC0xJztcblxuICBwcml2YXRlIHJlYWRvbmx5IG9yZ2FuaXphdGlvbkFwaTogQXBpTmVzdGVkU3RhY2s7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvamVjdEFwaTogQXBpTmVzdGVkU3RhY2s7XG4gIHByaXZhdGUgcmVhZG9ubHkgcXVlc3Rpb25BcGk6IEFwaU5lc3RlZFN0YWNrO1xuICBwcml2YXRlIHJlYWRvbmx5IGFuc3dlckFwaTogQXBpTmVzdGVkU3RhY2s7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJlc2lnbmVkVXJsQXBpOiBBcGlOZXN0ZWRTdGFjaztcbiAgcHJpdmF0ZSByZWFkb25seSBmaWxlQXBpOiBBcGlOZXN0ZWRTdGFjaztcbiAgcHJpdmF0ZSByZWFkb25seSB0ZXh0cmFjdEFwaTogQXBpTmVzdGVkU3RhY2s7XG4gIHByaXZhdGUgcmVhZG9ubHkga25vd2xlZGdlQmFzZUFwaTogQXBpTmVzdGVkU3RhY2s7XG4gIHByaXZhdGUgcmVhZG9ubHkgZG9jdW1lbnRBcGk6IEFwaU5lc3RlZFN0YWNrO1xuICBwcml2YXRlIHJlYWRvbmx5IHF1ZXN0aW9uRmlsZUFwaTogQXBpTmVzdGVkU3RhY2s7XG5cblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXBpU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3Qge1xuICAgICAgc3RhZ2UsXG4gICAgICBkb2N1bWVudHNCdWNrZXQsXG4gICAgICBtYWluVGFibGUsXG4gICAgICB1c2VyUG9vbCxcbiAgICAgIHVzZXJQb29sQ2xpZW50LFxuICAgICAgZG9jdW1lbnRQaXBlbGluZVN0YXRlTWFjaGluZUFybixcbiAgICAgIHF1ZXN0aW9uUGlwZWxpbmVTdGF0ZU1hY2hpbmVBcm4sXG4gICAgICBvcGVuU2VhcmNoQ29sbGVjdGlvbkVuZHBvaW50LFxuICAgICAgdnBjXG4gICAgfSA9IHByb3BzO1xuXG4gICAgLy8gMSkgQ29tbW9uIFJFU1QgQVBJXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ3cuUmVzdEFwaSh0aGlzLCAnQXV0b1JmcEFwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBgQXV0b1JGUCBBUEkgKCR7c3RhZ2V9KWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0F1dG9SRlAgQVBJIEdhdGV3YXknLFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6IHN0YWdlLFxuICAgICAgICBtZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgICAgbG9nZ2luZ0xldmVsOiBhcGlndy5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgZGF0YVRyYWNlRW5hYmxlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlndy5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWd3LkNvcnMuQUxMX01FVEhPRFMsXG4gICAgICAgIGFsbG93SGVhZGVyczogW1xuICAgICAgICAgICdDb250ZW50LVR5cGUnLFxuICAgICAgICAgICdBdXRob3JpemF0aW9uJyxcbiAgICAgICAgICAnWC1BbXotRGF0ZScsXG4gICAgICAgICAgJ1gtQXBpLUtleScsXG4gICAgICAgICAgJ1gtQW16LVNlY3VyaXR5LVRva2VuJyxcbiAgICAgICAgXSxcbiAgICAgICAgYWxsb3dDcmVkZW50aWFsczogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyAyKSBTaGFyZWQgTGFtYmRhIHJvbGUgZm9yIGFsbCBBUEkgbGFtYmRhc1xuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0NvbW1vbkxhbWJkYVJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIHJvbGVOYW1lOiBgYXV0by1yZnAtYXBpLWxhbWJkYS1yb2xlLSR7c3RhZ2V9YCxcbiAgICB9KTtcblxuICAgIHRoaXMubGFtYmRhUGVybWlzc2lvbnMgPSBbXG4gICAgICBuZXcgY2RrLmF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWydleGVjdXRlLWFwaTpJbnZva2UnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgZWZmZWN0OiBjZGsuYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICB9KSxcbiAgICAgIG5ldyBjZGsuYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ3MzOionXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgZWZmZWN0OiBjZGsuYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICB9KSxcbiAgICAgIG5ldyBjZGsuYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluQ3JlYXRlVXNlcicsXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluVXBkYXRlVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkRlbGV0ZVVzZXInLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkdldFVzZXInLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtwcm9wcy51c2VyUG9vbC51c2VyUG9vbEFybl0sXG4gICAgICAgIGVmZmVjdDogY2RrLmF3c19pYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgfSksXG4gICAgICBuZXcgY2RrLmF3c19pYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWydsb2dzOionXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgZWZmZWN0OiBjZGsuYXdzX2lhbS5FZmZlY3QuQUxMT1csXG4gICAgICB9KSxcbiAgICAgIG5ldyBjZGsuYXdzX2lhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ2xhbWJkYTpJbnZva2VGdW5jdGlvbiddLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICBlZmZlY3Q6IGNkay5hd3NfaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIH0pLFxuICAgICAgbmV3IGNkay5hd3NfaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnc2VjcmV0c21hbmFnZXI6R2V0U2VjcmV0VmFsdWUnXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbYCR7cHJvY2Vzcy5lbnYuQkJfUFJPRF9DUkVERU5USUFMU19BUk4gfHwgJyonfWBdLFxuICAgICAgICBlZmZlY3Q6IGNkay5hd3NfaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIH0pLFxuICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBhY3Rpb25zOiBbJ2VzOkVTSHR0cFBvc3QnLCAnZXM6RVNIdHRwUHV0JywgJ2VzOkVTSHR0cEdldCddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAnYXJuOmF3czplczp1cy13ZXN0LTI6MDM5ODg1OTYxNDI3OmRvbWFpbi9wcm9kb3BlbnNlYXJjaGQtbHh0empwN2RyYnZzLyonLFxuICAgICAgICBdLFxuICAgICAgfSksXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnc3RhdGVzOlN0YXJ0RXhlY3V0aW9uJ10sXG4gICAgICAgICAgcmVzb3VyY2VzOiBbZG9jdW1lbnRQaXBlbGluZVN0YXRlTWFjaGluZUFybl0sXG4gICAgICAgIGVmZmVjdDogY2RrLmF3c19pYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgfSlcbiAgICBdO1xuXG4gICAgdGhpcy5wb2xpY3kgPSBuZXcgY2RrLmF3c19pYW0uUG9saWN5KHRoaXMsICdMYW1iZGFQb2xpY3knLCB7XG4gICAgICBzdGF0ZW1lbnRzOiB0aGlzLmxhbWJkYVBlcm1pc3Npb25zLFxuICAgIH0pO1xuXG4gICAgbGFtYmRhUm9sZS5hdHRhY2hJbmxpbmVQb2xpY3kodGhpcy5wb2xpY3kpO1xuXG4gICAgLy8gQmFzaWMgbGFtYmRhIGV4ZWN1dGlvbiAobG9ncywgZXRjLilcbiAgICBsYW1iZGFSb2xlLmFkZE1hbmFnZWRQb2xpY3koXG4gICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnKSxcbiAgICApO1xuXG4gICAgLy8gRHluYW1vREIgYWNjZXNzIGZvciB0aGUgbWFpbiB0YWJsZVxuICAgIG1haW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEobGFtYmRhUm9sZSk7XG5cbiAgICAvLyBTMyBkb2NzIGJ1Y2tldFxuICAgIGRvY3VtZW50c0J1Y2tldC5ncmFudFJlYWRXcml0ZShsYW1iZGFSb2xlKTtcblxuICAgIC8vIENvZ25pdG8gYWRtaW4gb3BzIChpZiB5b3UgbmVlZCB0aGVtIGZyb20gTGFtYmRhKVxuICAgIGxhbWJkYVJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnY29nbml0by1pZHA6QWRtaW5Jbml0aWF0ZUF1dGgnLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkNyZWF0ZVVzZXInLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pblNldFVzZXJQYXNzd29yZCcsXG4gICAgICAgICAgJ2NvZ25pdG8taWRwOkFkbWluVXBkYXRlVXNlckF0dHJpYnV0ZXMnLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkdldFVzZXInLFxuICAgICAgICAgICdjb2duaXRvLWlkcDpMaXN0VXNlcnMnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFt1c2VyUG9vbC51c2VyUG9vbEFybl0sXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICAvLyBCZWRyb2NrIChvcHRpb25hbCwga2VlcCBpZiB5b3UgdXNlIGl0KVxuICAgIGxhbWJkYVJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnYmVkcm9jazpJbnZva2VNb2RlbCcsICdiZWRyb2NrOkludm9rZU1vZGVsV2l0aFJlc3BvbnNlU3RyZWFtJ10sXG4gICAgICAgIHJlc291cmNlczogW1wiKlwiXSxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIGxhbWJkYVJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAndGV4dHJhY3Q6U3RhcnREb2N1bWVudFRleHREZXRlY3Rpb24nLFxuICAgICAgICAgICd0ZXh0cmFjdDpHZXREb2N1bWVudFRleHREZXRlY3Rpb24nLFxuICAgICAgICAgICd0ZXh0cmFjdDpEZXRlY3REb2N1bWVudFRleHQnLFxuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgbGFtYmRhUm9sZS5hZGRUb1ByaW5jaXBhbFBvbGljeShcbiAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgYWN0aW9uczogWydzdGF0ZXM6U3RhcnRFeGVjdXRpb24nXSxcbiAgICAgICAgcmVzb3VyY2VzOiBbJyonXSxcbiAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgfSksXG4gICAgKTtcblxuICAgIGxhbWJkYVJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnYW9zczoqJ10sXG4gICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gU1NNIFBhcmFtZXRlciBTdG9yZSBhY2Nlc3MgZm9yIEJlZHJvY2sgQVBJIGtleVxuICAgIGxhbWJkYVJvbGUuYWRkVG9QcmluY2lwYWxQb2xpY3koXG4gICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGFjdGlvbnM6IFsnc3NtOkdldFBhcmFtZXRlciddLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBgYXJuOmF3czpzc206JHtBcGlTdGFjay5CRURST0NLX1JFR0lPTn06JHtjZGsuQXdzLkFDQ09VTlRfSUR9OnBhcmFtZXRlci9hdXRvLXJmcC9iZWRyb2NrL2FwaS1rZXlgXG4gICAgICAgIF0sXG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIH0pXG4gICAgKVxuXG4gICAgLy8gMykgQ29tbW9uIGVudiB0aGF0IGV2ZXJ5IGxhbWJkYSB3aWxsIGdldCBieSBkZWZhdWx0XG4gICAgLy8gICAgQWRqdXN0IFBLL1NLIGVudiBuYW1lcyB0byB3aGF0IHlvdSBhY3R1YWxseSB1c2UuXG4gICAgY29uc3QgY29tbW9uRW52OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgU1RBR0U6IHN0YWdlLFxuICAgICAgQVdTX0FDQ09VTlRfSUQ6IGNkay5Bd3MuQUNDT1VOVF9JRCxcbiAgICAgIERPQ1VNRU5UU19CVUNLRVQ6IGRvY3VtZW50c0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgTk9ERV9FTlY6ICdwcm9kdWN0aW9uJyxcblxuICAgICAgLy8gRHluYW1vREIgc2luZ2xlLXRhYmxlIGNvbmZpZ1xuICAgICAgREJfVEFCTEVfTkFNRTogbWFpblRhYmxlLnRhYmxlTmFtZSxcblxuICAgICAgLy8gQ29nbml0byBjb25maWcgZm9yIGJhY2tlbmQgdXNlXG4gICAgICBDT0dOSVRPX1VTRVJfUE9PTF9JRDogdXNlclBvb2wudXNlclBvb2xJZCxcbiAgICAgIENPR05JVE9fVVNFUl9QT09MX0NMSUVOVF9JRDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcblxuICAgICAgQkVEUk9DS19SRUdJT046ICd1cy1lYXN0LTEnLFxuICAgICAgQkVEUk9DS19FTUJFRERJTkdfTU9ERUxfSUQ6ICdhbWF6b24udGl0YW4tZW1iZWQtdGV4dC12MjowJyxcbiAgICAgIEJFRFJPQ0tfTU9ERUxfSUQ6ICdhbnRocm9waWMuY2xhdWRlLTMtaGFpa3UtMjAyNDAzMDctdjE6MCcsXG4gICAgICBCRURST0NLX0FQSV9LRVlfU1NNX1BBUkFNOiAnL2F1dG8tcmZwL2JlZHJvY2svYXBpLWtleScsXG4gICAgICBPUEVOU0VBUkNIX0lOREVYOiAnZG9jdW1lbnRzJyxcbiAgICAgIFNUQVRFX01BQ0hJTkVfQVJOOiBkb2N1bWVudFBpcGVsaW5lU3RhdGVNYWNoaW5lQXJuLFxuICAgICAgUVVFU1RJT05fUElQRUxJTkVfU1RBVEVfTUFDSElORV9BUk46IHF1ZXN0aW9uUGlwZWxpbmVTdGF0ZU1hY2hpbmVBcm4sXG4gICAgICBPUEVOU0VBUkNIX0VORFBPSU5UOiBvcGVuU2VhcmNoQ29sbGVjdGlvbkVuZHBvaW50XG4gICAgfTtcblxuICAgIC8vIDQpIEZpcnN0IGVudGl0eTogT3JnYW5pemF0aW9uIEFQSVxuICAgIHRoaXMub3JnYW5pemF0aW9uQXBpID0gbmV3IEFwaU5lc3RlZFN0YWNrKHRoaXMsICdPcmdhbml6YXRpb25BcGknLCB7XG4gICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgYmFzZVBhdGg6ICdvcmdhbml6YXRpb24nLFxuICAgICAgbGFtYmRhUm9sZSxcbiAgICAgIGNvbW1vbkVudixcbiAgICAgIHVzZXJQb29sXG4gICAgfSk7XG5cbiAgICB0aGlzLnByb2plY3RBcGkgPSBuZXcgQXBpTmVzdGVkU3RhY2sodGhpcywgJ1Byb2plY3RBcGknLCB7XG4gICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgYmFzZVBhdGg6ICdwcm9qZWN0JyxcbiAgICAgIGxhbWJkYVJvbGUsXG4gICAgICBjb21tb25FbnYsXG4gICAgICB1c2VyUG9vbFxuICAgIH0pO1xuXG4gICAgdGhpcy5xdWVzdGlvbkFwaSA9IG5ldyBBcGlOZXN0ZWRTdGFjayh0aGlzLCAnUXVlc3Rpb25BcGknLCB7XG4gICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgYmFzZVBhdGg6ICdxdWVzdGlvbicsXG4gICAgICBsYW1iZGFSb2xlLFxuICAgICAgY29tbW9uRW52LFxuICAgICAgdXNlclBvb2xcbiAgICB9KTtcblxuICAgIHRoaXMuYW5zd2VyQXBpID0gbmV3IEFwaU5lc3RlZFN0YWNrKHRoaXMsICdBbnN3ZXJBcGknLCB7XG4gICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgYmFzZVBhdGg6ICdhbnN3ZXInLFxuICAgICAgbGFtYmRhUm9sZSxcbiAgICAgIGNvbW1vbkVudixcbiAgICAgIHVzZXJQb29sXG4gICAgfSk7XG5cbiAgICB0aGlzLnByZXNpZ25lZFVybEFwaSA9IG5ldyBBcGlOZXN0ZWRTdGFjayh0aGlzLCAnUHJlc2lnbmVkVXJsQXBpJywge1xuICAgICAgYXBpOiB0aGlzLmFwaSxcbiAgICAgIGJhc2VQYXRoOiAncHJlc2lnbmVkJyxcbiAgICAgIGxhbWJkYVJvbGUsXG4gICAgICBjb21tb25FbnYsXG4gICAgICB1c2VyUG9vbFxuICAgIH0pO1xuXG4gICAgdGhpcy5maWxlQXBpID0gbmV3IEFwaU5lc3RlZFN0YWNrKHRoaXMsICdGaWxlQXBpJywge1xuICAgICAgYXBpOiB0aGlzLmFwaSxcbiAgICAgIGJhc2VQYXRoOiAnZmlsZScsXG4gICAgICBsYW1iZGFSb2xlLFxuICAgICAgY29tbW9uRW52LFxuICAgICAgdXNlclBvb2xcbiAgICB9KTtcblxuICAgIHRoaXMudGV4dHJhY3RBcGkgPSBuZXcgQXBpTmVzdGVkU3RhY2sodGhpcywgJ1RleHRyYWN0QXBpJywge1xuICAgICAgYXBpOiB0aGlzLmFwaSxcbiAgICAgIGJhc2VQYXRoOiAndGV4dHJhY3QnLFxuICAgICAgbGFtYmRhUm9sZSxcbiAgICAgIGNvbW1vbkVudixcbiAgICAgIHVzZXJQb29sXG4gICAgfSk7XG5cbiAgICB0aGlzLmtub3dsZWRnZUJhc2VBcGkgPSBuZXcgQXBpTmVzdGVkU3RhY2sodGhpcywgJ0tub3dsZWRnZUJhc2VBcGknLCB7XG4gICAgICBhcGk6IHRoaXMuYXBpLFxuICAgICAgYmFzZVBhdGg6ICdrbm93bGVkZ2ViYXNlJyxcbiAgICAgIGxhbWJkYVJvbGUsXG4gICAgICBjb21tb25FbnYsXG4gICAgICB1c2VyUG9vbFxuICAgIH0pO1xuXG5cbiAgICB0aGlzLnF1ZXN0aW9uRmlsZUFwaSA9IG5ldyBBcGlOZXN0ZWRTdGFjayh0aGlzLCAnUXVlc3Rpb25GaWxlQXBpJywge1xuICAgICAgYXBpOiB0aGlzLmFwaSxcbiAgICAgIGJhc2VQYXRoOiAncXVlc3Rpb25maWxlJyxcbiAgICAgIGxhbWJkYVJvbGUsXG4gICAgICBjb21tb25FbnYsXG4gICAgICB1c2VyUG9vbFxuICAgIH0pXG5cbiAgICB0aGlzLnF1ZXN0aW9uRmlsZUFwaS5hZGRSb3V0ZShcbiAgICAgICcvc3RhcnQtcXVlc3Rpb24tcGlwZWxpbmUnLFxuICAgICAgJ1BPU1QnLFxuICAgICAgJ2xhbWJkYS9xdWVzdGlvbi1maWxlL3N0YXJ0LXF1ZXN0aW9uLXBpcGVsaW5lLnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5xdWVzdGlvbkZpbGVBcGkuYWRkUm91dGUoXG4gICAgICAnL2NyZWF0ZS1xdWVzdGlvbi1maWxlJyxcbiAgICAgICdQT1NUJyxcbiAgICAgICdsYW1iZGEvcXVlc3Rpb24tZmlsZS9jcmVhdGUtcXVlc3Rpb24tZmlsZS50cycsXG4gICAgKTtcblxuICAgIHRoaXMucXVlc3Rpb25GaWxlQXBpLmFkZFJvdXRlKFxuICAgICAgJy9nZXQtcXVlc3Rpb24tZmlsZScsXG4gICAgICAnR0VUJyxcbiAgICAgICdsYW1iZGEvcXVlc3Rpb24tZmlsZS9nZXQtcXVlc3Rpb24tZmlsZS50cycsXG4gICAgKTtcblxuICAgIHRoaXMua25vd2xlZGdlQmFzZUFwaS5hZGRSb3V0ZShcbiAgICAgICcvY3JlYXRlLWtub3dsZWRnZWJhc2UnLFxuICAgICAgJ1BPU1QnLFxuICAgICAgJ2xhbWJkYS9rbm93bGVkZ2ViYXNlL2NyZWF0ZS1rbm93bGVkZ2ViYXNlLnRzJyxcbiAgICApXG5cbiAgICB0aGlzLmtub3dsZWRnZUJhc2VBcGkuYWRkUm91dGUoXG4gICAgICAnL2RlbGV0ZS1rbm93bGVkZ2ViYXNlJyxcbiAgICAgICdERUxFVEUnLFxuICAgICAgJ2xhbWJkYS9rbm93bGVkZ2ViYXNlL2RlbGV0ZS1rbm93bGVkZ2ViYXNlLnRzJyxcbiAgICApXG5cbiAgICB0aGlzLmtub3dsZWRnZUJhc2VBcGkuYWRkUm91dGUoXG4gICAgICAnL2VkaXQta25vd2xlZGdlYmFzZScsXG4gICAgICAnUEFUQ0gnLFxuICAgICAgJ2xhbWJkYS9rbm93bGVkZ2ViYXNlL2VkaXQta25vd2xlZGdlYmFzZS50cycsXG4gICAgKVxuXG4gICAgdGhpcy5rbm93bGVkZ2VCYXNlQXBpLmFkZFJvdXRlKFxuICAgICAgJy9nZXQta25vd2xlZGdlYmFzZXMnLFxuICAgICAgJ0dFVCcsXG4gICAgICAnbGFtYmRhL2tub3dsZWRnZWJhc2UvZ2V0LWtub3dsZWRnZWJhc2VzLnRzJyxcbiAgICApXG5cbiAgICB0aGlzLmtub3dsZWRnZUJhc2VBcGkuYWRkUm91dGUoXG4gICAgICAnL2dldC1rbm93bGVkZ2ViYXNlJyxcbiAgICAgICdHRVQnLFxuICAgICAgJ2xhbWJkYS9rbm93bGVkZ2ViYXNlL2dldC1rbm93bGVkZ2ViYXNlLnRzJyxcbiAgICApXG5cbiAgICB0aGlzLmRvY3VtZW50QXBpID0gbmV3IEFwaU5lc3RlZFN0YWNrKHRoaXMsICdEb2N1bWVudEFwaScsIHtcbiAgICAgIGFwaTogdGhpcy5hcGksXG4gICAgICBiYXNlUGF0aDogJ2RvY3VtZW50JyxcbiAgICAgIGxhbWJkYVJvbGUsXG4gICAgICBjb21tb25FbnYsXG4gICAgICB1c2VyUG9vbCxcbiAgICB9KTtcblxuICAgIHRoaXMuZG9jdW1lbnRBcGkuYWRkUm91dGUoXG4gICAgICAnL2NyZWF0ZS1kb2N1bWVudCcsXG4gICAgICAnUE9TVCcsXG4gICAgICAnbGFtYmRhL2RvY3VtZW50L2NyZWF0ZS1kb2N1bWVudC50cycsXG4gICAgKTtcblxuICAgIHRoaXMuZG9jdW1lbnRBcGkuYWRkUm91dGUoXG4gICAgICAnL2VkaXQtZG9jdW1lbnQnLFxuICAgICAgJ1BBVENIJyxcbiAgICAgICdsYW1iZGEvZG9jdW1lbnQvZWRpdC1kb2N1bWVudC50cycsXG4gICAgKTtcblxuICAgIHRoaXMuZG9jdW1lbnRBcGkuYWRkUm91dGUoXG4gICAgICAnL2RlbGV0ZS1kb2N1bWVudCcsXG4gICAgICAnREVMRVRFJyxcbiAgICAgICdsYW1iZGEvZG9jdW1lbnQvZGVsZXRlLWRvY3VtZW50LnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5kb2N1bWVudEFwaS5hZGRSb3V0ZShcbiAgICAgICcvZ2V0LWRvY3VtZW50cycsXG4gICAgICAnR0VUJyxcbiAgICAgICdsYW1iZGEvZG9jdW1lbnQvZ2V0LWRvY3VtZW50cy50cycsXG4gICAgKTtcblxuICAgIHRoaXMuZG9jdW1lbnRBcGkuYWRkUm91dGUoXG4gICAgICAnL2dldC1kb2N1bWVudCcsXG4gICAgICAnR0VUJyxcbiAgICAgICdsYW1iZGEvZG9jdW1lbnQvZ2V0LWRvY3VtZW50LnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5kb2N1bWVudEFwaS5hZGRSb3V0ZShcbiAgICAgICcvc3RhcnQtZG9jdW1lbnQtcGlwZWxpbmUnLFxuICAgICAgJ1BPU1QnLFxuICAgICAgJ2xhbWJkYS9kb2N1bWVudC9zdGFydC1kb2N1bWVudC1waXBlbGluZS50cycsXG4gICAgKTtcblxuXG4gICAgdGhpcy5vcmdhbml6YXRpb25BcGkuYWRkUm91dGUoXG4gICAgICAnL2dldC1vcmdhbml6YXRpb25zJyxcbiAgICAgICdHRVQnLFxuICAgICAgJ2xhbWJkYS9vcmdhbml6YXRpb24vZ2V0LW9yZ2FuaXphdGlvbnMudHMnLFxuICAgICk7XG5cbiAgICB0aGlzLm9yZ2FuaXphdGlvbkFwaS5hZGRSb3V0ZShcbiAgICAgICcvY3JlYXRlLW9yZ2FuaXphdGlvbicsXG4gICAgICAnUE9TVCcsXG4gICAgICAnbGFtYmRhL29yZ2FuaXphdGlvbi9jcmVhdGUtb3JnYW5pemF0aW9uLnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5vcmdhbml6YXRpb25BcGkuYWRkUm91dGUoXG4gICAgICAnL2VkaXQtb3JnYW5pemF0aW9uL3tpZH0nLFxuICAgICAgJ1BBVENIJyxcbiAgICAgICdsYW1iZGEvb3JnYW5pemF0aW9uL2VkaXQtb3JnYW5pemF0aW9uLnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5vcmdhbml6YXRpb25BcGkuYWRkUm91dGUoXG4gICAgICAnL2dldC1vcmdhbml6YXRpb24ve2lkfScsXG4gICAgICAnR0VUJyxcbiAgICAgICdsYW1iZGEvb3JnYW5pemF0aW9uL2dldC1vcmdhbml6YXRpb24tYnktaWQudHMnLFxuICAgICk7XG5cbiAgICB0aGlzLm9yZ2FuaXphdGlvbkFwaS5hZGRSb3V0ZShcbiAgICAgICcvZGVsZXRlLW9yZ2FuaXphdGlvbicsXG4gICAgICAnREVMRVRFJyxcbiAgICAgICdsYW1iZGEvb3JnYW5pemF0aW9uL2RlbGV0ZS1vcmdhbml6YXRpb24udHMnLFxuICAgICk7XG5cbiAgICB0aGlzLnByb2plY3RBcGkuYWRkUm91dGUoXG4gICAgICAnL2dldC1wcm9qZWN0cycsXG4gICAgICAnR0VUJyxcbiAgICAgICdsYW1iZGEvcHJvamVjdC9nZXQtcHJvamVjdHMudHMnLFxuICAgICk7XG5cbiAgICB0aGlzLnByb2plY3RBcGkuYWRkUm91dGUoXG4gICAgICAnL2NyZWF0ZS1wcm9qZWN0JyxcbiAgICAgICdQT1NUJyxcbiAgICAgICdsYW1iZGEvcHJvamVjdC9jcmVhdGUtcHJvamVjdC50cycsXG4gICAgKTtcblxuICAgIHRoaXMucHJvamVjdEFwaS5hZGRSb3V0ZShcbiAgICAgICcvZ2V0LXByb2plY3Qve2lkfScsXG4gICAgICAnR0VUJyxcbiAgICAgICdsYW1iZGEvcHJvamVjdC9nZXQtcHJvamVjdC1ieS1pZC50cycsXG4gICAgKTtcblxuICAgIHRoaXMucHJvamVjdEFwaS5hZGRSb3V0ZShcbiAgICAgICcvZWRpdC1wcm9qZWN0JyxcbiAgICAgICdQQVRDSCcsXG4gICAgICAnbGFtYmRhL3Byb2plY3QvZWRpdC1wcm9qZWN0LnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5wcm9qZWN0QXBpLmFkZFJvdXRlKFxuICAgICAgJy9kZWxldGUtcHJvamVjdC97aWR9JyxcbiAgICAgICdERUxFVEUnLFxuICAgICAgJ2xhbWJkYS9wcm9qZWN0L2RlbGV0ZS1wcm9qZWN0LnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5wcm9qZWN0QXBpLmFkZFJvdXRlKFxuICAgICAgJy9nZXQtcXVlc3Rpb25zL3tpZH0nLFxuICAgICAgJ0dFVCcsXG4gICAgICAnbGFtYmRhL3Byb2plY3QvZ2V0LXF1ZXN0aW9ucy50cycsXG4gICAgKTtcblxuICAgIHRoaXMucXVlc3Rpb25BcGkuYWRkUm91dGUoXG4gICAgICAnL2V4dHJhY3QtcXVlc3Rpb25zJyxcbiAgICAgICdQT1NUJyxcbiAgICAgICdsYW1iZGEvcXVlc3Rpb24vZXh0cmFjdC1xdWVzdGlvbnMudHMnLFxuICAgICk7XG5cbiAgICB0aGlzLnF1ZXN0aW9uQXBpLmFkZFJvdXRlKFxuICAgICAgJy9leHRyYWN0LXRleHQnLFxuICAgICAgJ1BPU1QnLFxuICAgICAgJ2xhbWJkYS9xdWVzdGlvbi9leHRyYWN0LXRleHQudHMnLFxuICAgICk7XG5cbiAgICB0aGlzLnByZXNpZ25lZFVybEFwaS5hZGRSb3V0ZShcbiAgICAgICcvcHJlc2lnbmVkLXVybCcsXG4gICAgICAnUE9TVCcsXG4gICAgICAnbGFtYmRhL3ByZXNpZ25lZC9nZW5lcmF0ZS1wcmVzaWduZWQtdXJsLnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5maWxlQXBpLmFkZFJvdXRlKFxuICAgICAgJy9jb252ZXJ0LXRvLXRleHQnLFxuICAgICAgJ1BPU1QnLFxuICAgICAgJ2xhbWJkYS9maWxlL2NvbnZlcnQtdG8tdGV4dC50cycsXG4gICAgKTtcblxuICAgIHRoaXMuZmlsZUFwaS5hZGRSb3V0ZShcbiAgICAgICcvZ2V0LXRleHQnLFxuICAgICAgJ1BPU1QnLFxuICAgICAgJ2xhbWJkYS9maWxlL2dldC10ZXh0LnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy50ZXh0cmFjdEFwaS5hZGRSb3V0ZShcbiAgICAgICcvYmVnaW4tZXh0cmFjdGlvbicsXG4gICAgICAnUE9TVCcsXG4gICAgICAnbGFtYmRhL3RleHRyYWN0L2JlZ2luLWV4dHJhY3Rpb24udHMnLFxuICAgICk7XG5cblxuICAgIHRoaXMuYW5zd2VyQXBpLmFkZFJvdXRlKFxuICAgICAgJy9nZXQtYW5zd2Vycy97aWR9JyxcbiAgICAgICdHRVQnLFxuICAgICAgJ2xhbWJkYS9hbnN3ZXIvZ2V0LWFuc3dlcnMudHMnLFxuICAgICk7XG5cbiAgICB0aGlzLmFuc3dlckFwaS5hZGRSb3V0ZShcbiAgICAgICcvY3JlYXRlLWFuc3dlcicsXG4gICAgICAnUE9TVCcsXG4gICAgICAnbGFtYmRhL2Fuc3dlci9jcmVhdGUtYW5zd2VyLnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5hbnN3ZXJBcGkuYWRkUm91dGUoXG4gICAgICAnL3NhdmUtYW5zd2VyJyxcbiAgICAgICdQT1NUJyxcbiAgICAgICdsYW1iZGEvYW5zd2VyL3NhdmUtYW5zd2VyLnRzJyxcbiAgICApO1xuXG4gICAgdGhpcy5hbnN3ZXJBcGkuYWRkUm91dGUoXG4gICAgICAnL2dlbmVyYXRlLWFuc3dlcicsXG4gICAgICAnUE9TVCcsXG4gICAgICAnbGFtYmRhL2Fuc3dlci9nZW5lcmF0ZS1hbnN3ZXIudHMnLFxuICAgICk7XG5cbiAgICB0aGlzLnRleHRyYWN0QXBpLmFkZFJvdXRlKFxuICAgICAgJy9nZXQtcmVzdWx0JyxcbiAgICAgICdQT1NUJyxcbiAgICAgICdsYW1iZGEvdGV4dHJhY3QvZ2V0LXJlc3VsdC50cycsXG4gICAgKTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlCYXNlVXJsJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQmFzZSBVUkwgZm9yIHRoZSBBdXRvUkZQIEFQSScsXG4gICAgfSk7XG5cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkUmVzb3VyY2VTdXBwcmVzc2lvbnMoXG4gICAgICB0aGlzLmFwaSxcbiAgICAgIFtcbiAgICAgICAge1xuICAgICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUcxJyxcbiAgICAgICAgICByZWFzb246ICdBY2Nlc3MgbG9nZ2luZyB3aWxsIGJlIGNvbmZpZ3VyZWQgZm9yIHByb2R1Y3Rpb247IGRldiBlbnZpcm9ubWVudCBrZWVwcyBpdCBvZmYgZm9yIHNwZWVkLicsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHMicsXG4gICAgICAgICAgcmVhc29uOiAnUmVxdWVzdCB2YWxpZGF0aW9uIHdpbGwgYmUgYWRkZWQgZm9yIHByb2R1Y3Rpb24gb25jZSB0aGUgY29udHJhY3QgaXMgZmluYWxpemVkLicsXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHNCcsXG4gICAgICAgICAgcmVhc29uOiAnQ29nbml0byAvIElBTSBhdXRob3JpemVycyB3aWxsIGJlIGFkZGVkIHdoZW4gdGhlIGF1dGggbW9kZWwgaXMgc3RhYmxlOyBkZXYgQVBJIGlzIG9wZW4gYmVoaW5kIGludGVybmFsIGFjY2Vzcy4nLFxuICAgICAgICB9LFxuICAgICAgICB7XG4gICAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HNCcsXG4gICAgICAgICAgcmVhc29uOiAnQ29nbml0byB1c2VyIHBvb2wgYXV0aG9yaXplciB3aWxsIGJlIGF0dGFjaGVkIGluIHByb2R1Y3Rpb247IGRldiBzdGFjayBpcyB1bmF1dGhlbnRpY2F0ZWQuJyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICB0cnVlLCAvLyBhcHBseVRvQ2hpbGRyZW4gPSB0cnVlIChjb3ZlcnMgbWV0aG9kcylcbiAgICApO1xuXG4gICAgLy8gVE9ETzogQWRkIENESyBOQUcgc3VwcHJlc3Npb25zIGZvciBkZXZlbG9wbWVudCAtIFJFTU9WRSBJTiBQUk9EVUNUSU9OXG4gICAgLy8gVGhlc2Ugc3VwcHJlc3Npb25zIGFsbG93IGRlcGxveW1lbnQgd2hpbGUgc2VjdXJpdHkgaXNzdWVzIGFyZSBhZGRyZXNzZWRcbiAgICB0aGlzLmFkZENka05hZ1N1cHByZXNzaW9ucygpO1xuICB9XG5cblxuXG5cblxuICAvLyBMYXRlciB5b3UgY2FuIGFkZDpcbiAgLy8gdGhpcy51c2VyQXBpID0gbmV3IEFwaU5lc3RlZFN0YWNrKHRoaXMsICdVc2VyQXBpJywgeyBhcGk6IHRoaXMuYXBpLCBiYXNlUGF0aDogJ3VzZXInLCB0aGlzLmxhbWJkYVJvbGUsIGNvbW1vbkVudiB9KTtcbiAgLy8gdGhpcy51c2VyQXBpLmFkZFJvdXRlKCcvZ2V0LXVzZXJzJywgJ0dFVCcsICdsYW1iZGEvdXNlci9nZXQtdXNlcnMudHMnKTtcbiAgLy8gVE9ETzogUkVNT1ZFIElOIFBST0RVQ1RJT04gLSBUaGVzZSBzdXBwcmVzc2lvbnMgYXJlIGZvciBkZXZlbG9wbWVudCBvbmx5XG4gIC8vIEVhY2ggc3VwcHJlc3Npb24gbmVlZHMgdG8gYmUgYWRkcmVzc2VkIGZvciBwcm9kdWN0aW9uIGRlcGxveW1lbnRcbiAgcHJpdmF0ZSBhZGRDZGtOYWdTdXBwcmVzc2lvbnMoKTogdm9pZCB7XG4gICAgLy8gU3VwcHJlc3MgQUxMIENESyBOQUcgZXJyb3JzIGZvciBkZXZlbG9wbWVudCBkZXBsb3ltZW50XG4gICAgLy8gVE9ETzogUmVtb3ZlIHRoZXNlIHN1cHByZXNzaW9ucyBhbmQgZml4IGVhY2ggc2VjdXJpdHkgaXNzdWUgZm9yIHByb2R1Y3Rpb25cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkU3RhY2tTdXBwcmVzc2lvbnModGhpcywgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1WUEM3JyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogVlBDIEZsb3cgTG9ncyB3aWxsIGJlIGFkZGVkIGluIHByb2R1Y3Rpb24gZm9yIG5ldHdvcmsgbW9uaXRvcmluZycsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TTUc0JyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQWRkIGF1dG9tYXRpYyBzZWNyZXQgcm90YXRpb24gZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtRUMyMycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFJlc3RyaWN0IGRhdGFiYXNlIGFjY2VzcyB0byBzcGVjaWZpYyBJUCByYW5nZXMgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUkRTMycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBNdWx0aS1BWiBmb3IgcHJvZHVjdGlvbiBoaWdoIGF2YWlsYWJpbGl0eScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1SRFMxMCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBkZWxldGlvbiBwcm90ZWN0aW9uIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVJEUzExJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogVXNlIG5vbi1kZWZhdWx0IGRhdGFiYXNlIHBvcnQgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HMScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFN0cmVuZ3RoZW4gcGFzc3dvcmQgcG9saWN5IHRvIHJlcXVpcmUgc3BlY2lhbCBjaGFyYWN0ZXJzJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzInLFxuICAgICAgICByZWFzb246ICdUT0RPOiBFbmFibGUgTUZBIGZvciBwcm9kdWN0aW9uIHVzZXIgYXV0aGVudGljYXRpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HMycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBhZHZhbmNlZCBzZWN1cml0eSBtb2RlIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzQnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBBZGQgQ29nbml0byBVc2VyIFBvb2wgYXV0aG9yaXplciB0byBBUEkgR2F0ZXdheScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TMScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBTMyBzZXJ2ZXIgYWNjZXNzIGxvZ2dpbmcgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUzEwJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQWRkIFNTTC1vbmx5IGJ1Y2tldCBwb2xpY2llcyBmb3IgcHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1MMScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFVwZGF0ZSB0byBsYXRlc3QgTm9kZS5qcyBydW50aW1lIHZlcnNpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFJlcGxhY2UgQVdTIG1hbmFnZWQgcG9saWNpZXMgd2l0aCBjdXN0b20gcG9saWNpZXMnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFJlbW92ZSB3aWxkY2FyZCBwZXJtaXNzaW9ucyBhbmQgdXNlIHNwZWNpZmljIHJlc291cmNlIEFSTnMnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQVBJRzEnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBFbmFibGUgQVBJIEdhdGV3YXkgYWNjZXNzIGxvZ2dpbmcgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQVBJRzInLFxuICAgICAgICByZWFzb246ICdUT0RPOiBBZGQgcmVxdWVzdCB2YWxpZGF0aW9uIHRvIEFQSSBHYXRld2F5JyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUczJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQXNzb2NpYXRlIEFQSSBHYXRld2F5IHdpdGggQVdTIFdBRiBmb3IgcHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHNCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEltcGxlbWVudCBBUEkgR2F0ZXdheSBhdXRob3JpemF0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjEnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBBZGQgZ2VvIHJlc3RyaWN0aW9ucyBpZiBuZWVkZWQgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSMicsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEludGVncmF0ZSBDbG91ZEZyb250IHdpdGggQVdTIFdBRiBmb3IgcHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DRlIzJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogRW5hYmxlIENsb3VkRnJvbnQgYWNjZXNzIGxvZ2dpbmcgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSNCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFVwZGF0ZSBDbG91ZEZyb250IHRvIHVzZSBUTFMgMS4yKyBtaW5pbXVtJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjcnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBVc2UgT3JpZ2luIEFjY2VzcyBDb250cm9sIGluc3RlYWQgb2YgT0FJJyxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==