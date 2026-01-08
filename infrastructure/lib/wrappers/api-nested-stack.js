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
exports.ApiNestedStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const nodejs = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const apigw = __importStar(require("aws-cdk-lib/aws-apigateway"));
const cdk_nag_1 = require("cdk-nag");
const aws_apigateway_1 = require("aws-cdk-lib/aws-apigateway");
class ApiNestedStack extends cdk.NestedStack {
    constructor(scope, id, props) {
        super(scope, id, props);
        this.lambdaIndex = 0;
        const { api, basePath, lambdaRole, commonEnv } = props;
        this.api = api;
        this.stage = this.api.deploymentStage;
        // /organization, /user, /patient, etc.
        this.baseResource = this.api.root.addResource(basePath);
        // Save for later use when creating lambdas
        this._lambdaRole = lambdaRole;
        this._commonEnv = commonEnv;
        this.authorizer = new apigw.CognitoUserPoolsAuthorizer(this, `${id}Authorizer`, {
            cognitoUserPools: [props.userPool],
        });
        this.addCdkNagSuppressions();
    }
    /**
     * Add a route + Lambda in this nested stack.
     *
     * path: '/get-organizations', '/{id}', '/create', etc.
     * method: 'GET' | 'POST' | 'PUT' | 'DELETE' | ...
     * handlerEntry: path to lambda file (NodejsFunction.entry)
     * extraEnv: per-function environment overrides
     */
    addRoute(path, method, handlerEntry, extraEnv) {
        const lambdaRole = this._lambdaRole;
        const commonEnv = this._commonEnv;
        // Build nested resources under basePath for this route
        const segments = path.split('/').filter(Boolean); // remove empty
        let resource = this.baseResource;
        for (const segment of segments) {
            resource = resource.addResource(segment);
        }
        // Create function name/id based on path + method
        const safeId = path
            .replace(/[^a-zA-Z0-9]/g, '-') // replace /{} with -
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
        const fnId = `${method}-${safeId || 'root'}-${this.lambdaIndex++}`;
        const fn = new nodejs.NodejsFunction(this, fnId, {
            runtime: lambda.Runtime.NODEJS_20_X,
            entry: handlerEntry,
            handler: 'handler',
            role: lambdaRole,
            timeout: cdk.Duration.seconds(30),
            memorySize: 512,
            environment: {
                ...commonEnv,
                ...(extraEnv ?? {}),
            },
            bundling: {
                minify: true,
                sourceMap: false,
                target: 'es2022',
                format: nodejs.OutputFormat.CJS,
                mainFields: ['module', 'main'],
                externalModules: [
                    '@aws-sdk/client-s3',
                    '@aws-sdk/client-secrets-manager',
                    '@aws-sdk/s3-request-presigner',
                    '@aws-sdk/client-rds-data',
                ],
            },
        });
        const integration = new apigw.LambdaIntegration(fn);
        resource.addMethod(method, integration, {
            authorizer: this.authorizer,
            authorizationType: aws_apigateway_1.AuthorizationType.COGNITO,
        });
    }
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
exports.ApiNestedStack = ApiNestedStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXBpLW5lc3RlZC1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbImFwaS1uZXN0ZWQtc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCxzRUFBd0Q7QUFDeEQsa0VBQW9EO0FBSXBELHFDQUEwQztBQUMxQywrREFBK0Q7QUErQi9ELE1BQWEsY0FBZSxTQUFRLEdBQUcsQ0FBQyxXQUFXO0lBT2pELFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBMEI7UUFDbEUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFIbEIsZ0JBQVcsR0FBRyxDQUFDLENBQUM7UUFLdEIsTUFBTSxFQUFFLEdBQUcsRUFBRSxRQUFRLEVBQUUsVUFBVSxFQUFFLFNBQVMsRUFBRSxHQUFHLEtBQUssQ0FBQztRQUV2RCxJQUFJLENBQUMsR0FBRyxHQUFHLEdBQUcsQ0FBQztRQUNmLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUM7UUFFdEMsdUNBQXVDO1FBQ3ZDLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRXhELDJDQUEyQztRQUMxQyxJQUFZLENBQUMsV0FBVyxHQUFHLFVBQVUsQ0FBQztRQUN0QyxJQUFZLENBQUMsVUFBVSxHQUFHLFNBQVMsQ0FBQztRQUVyQyxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksS0FBSyxDQUFDLDBCQUEwQixDQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsWUFBWSxFQUFFO1lBQzlFLGdCQUFnQixFQUFFLENBQUMsS0FBSyxDQUFDLFFBQVEsQ0FBQztTQUNuQyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMscUJBQXFCLEVBQUUsQ0FBQztJQUMv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OUQ7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsd0RBQXdEO2FBQ2pFO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLHVEQUF1RDthQUNoRTtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSxpREFBaUQ7YUFDMUQ7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsZ0RBQWdEO2FBQ3pEO1NBQ0YsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBdE1ELHdDQXNNQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBub2RlanMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xuaW1wb3J0ICogYXMgYXBpZ3cgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0bydcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0IHsgTmFnU3VwcHJlc3Npb25zIH0gZnJvbSAnY2RrLW5hZyc7XG5pbXBvcnQgeyBBdXRob3JpemF0aW9uVHlwZSB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCB7IElVc2VyUG9vbCB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcblxuZXhwb3J0IGludGVyZmFjZSBBcGlOZXN0ZWRTdGFja1Byb3BzIGV4dGVuZHMgY2RrLk5lc3RlZFN0YWNrUHJvcHMge1xuICAvKipcbiAgICogU2hhcmVkIEFQSSBHYXRld2F5IGZvciB0aGlzIHNlcnZpY2UgKGxpa2UgaW4geW91ciBleGFtcGxlIHN0YWNrKS5cbiAgICovXG4gIGFwaTogYXBpZ3cuSVJlc3RBcGk7XG5cbiAgLyoqXG4gICAqIEJhc2UgcGF0aCBzZWdtZW50IGZvciB0aGlzIOKAnGJvdW5kZWQgY29udGV4dOKAnS5cbiAgICogZS5nLiAnb3JnYW5pemF0aW9uJyDihpIgL29yZ2FuaXphdGlvbi8uLi5cbiAgICovXG4gIGJhc2VQYXRoOiBzdHJpbmc7XG5cbiAgLyoqXG4gICAqIENvbW1vbiBMYW1iZGEgcm9sZSBmb3IgYWxsIGZ1bmN0aW9ucyBpbiB0aGlzIG5lc3RlZCBzdGFja1xuICAgKiAoc2ltaWxhciB0byBDb21tb25MYW1iZGFSb2xlIGluIHlvdXIgZXhhbXBsZSkuXG4gICAqL1xuICBsYW1iZGFSb2xlOiBpYW0uSVJvbGU7XG5cbiAgLyoqXG4gICAqIEVudmlyb25tZW50IHZhcmlhYmxlcyBzaGFyZWQgYnkgYWxsIGxhbWJkYXMgaW4gdGhpcyBuZXN0ZWQgc3RhY2suXG4gICAqL1xuICBjb21tb25FbnY6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG5cblxuICB1c2VyUG9vbDogSVVzZXJQb29sLFxuXG59XG5cbmV4cG9ydCBjbGFzcyBBcGlOZXN0ZWRTdGFjayBleHRlbmRzIGNkay5OZXN0ZWRTdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBhcGk6IGFwaWd3LklSZXN0QXBpO1xuICBwdWJsaWMgcmVhZG9ubHkgc3RhZ2U6IGFwaWd3LlN0YWdlO1xuICBwcml2YXRlIHJlYWRvbmx5IGJhc2VSZXNvdXJjZTogYXBpZ3cuSVJlc291cmNlO1xuICBwcml2YXRlIHJlYWRvbmx5IGF1dGhvcml6ZXI6IGFwaWd3LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyO1xuICBwcml2YXRlIGxhbWJkYUluZGV4ID0gMDtcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogQXBpTmVzdGVkU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBhcGksIGJhc2VQYXRoLCBsYW1iZGFSb2xlLCBjb21tb25FbnYgfSA9IHByb3BzO1xuXG4gICAgdGhpcy5hcGkgPSBhcGk7XG4gICAgdGhpcy5zdGFnZSA9IHRoaXMuYXBpLmRlcGxveW1lbnRTdGFnZTtcblxuICAgIC8vIC9vcmdhbml6YXRpb24sIC91c2VyLCAvcGF0aWVudCwgZXRjLlxuICAgIHRoaXMuYmFzZVJlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZShiYXNlUGF0aCk7XG5cbiAgICAvLyBTYXZlIGZvciBsYXRlciB1c2Ugd2hlbiBjcmVhdGluZyBsYW1iZGFzXG4gICAgKHRoaXMgYXMgYW55KS5fbGFtYmRhUm9sZSA9IGxhbWJkYVJvbGU7XG4gICAgKHRoaXMgYXMgYW55KS5fY29tbW9uRW52ID0gY29tbW9uRW52O1xuXG4gICAgdGhpcy5hdXRob3JpemVyID0gbmV3IGFwaWd3LkNvZ25pdG9Vc2VyUG9vbHNBdXRob3JpemVyKHRoaXMsIGAke2lkfUF1dGhvcml6ZXJgLCB7XG4gICAgICBjb2duaXRvVXNlclBvb2xzOiBbcHJvcHMudXNlclBvb2xdLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hZGRDZGtOYWdTdXBwcmVzc2lvbnMoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYSByb3V0ZSArIExhbWJkYSBpbiB0aGlzIG5lc3RlZCBzdGFjay5cbiAgICpcbiAgICogcGF0aDogJy9nZXQtb3JnYW5pemF0aW9ucycsICcve2lkfScsICcvY3JlYXRlJywgZXRjLlxuICAgKiBtZXRob2Q6ICdHRVQnIHwgJ1BPU1QnIHwgJ1BVVCcgfCAnREVMRVRFJyB8IC4uLlxuICAgKiBoYW5kbGVyRW50cnk6IHBhdGggdG8gbGFtYmRhIGZpbGUgKE5vZGVqc0Z1bmN0aW9uLmVudHJ5KVxuICAgKiBleHRyYUVudjogcGVyLWZ1bmN0aW9uIGVudmlyb25tZW50IG92ZXJyaWRlc1xuICAgKi9cbiAgcHVibGljIGFkZFJvdXRlKFxuICAgIHBhdGg6IHN0cmluZyxcbiAgICBtZXRob2Q6IHN0cmluZyxcbiAgICBoYW5kbGVyRW50cnk6IHN0cmluZyxcbiAgICBleHRyYUVudj86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSAodGhpcyBhcyBhbnkpLl9sYW1iZGFSb2xlIGFzIGlhbS5JUm9sZTtcbiAgICBjb25zdCBjb21tb25FbnYgPSAodGhpcyBhcyBhbnkpLl9jb21tb25FbnYgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcblxuICAgIC8vIEJ1aWxkIG5lc3RlZCByZXNvdXJjZXMgdW5kZXIgYmFzZVBhdGggZm9yIHRoaXMgcm91dGVcbiAgICBjb25zdCBzZWdtZW50cyA9IHBhdGguc3BsaXQoJy8nKS5maWx0ZXIoQm9vbGVhbik7IC8vIHJlbW92ZSBlbXB0eVxuICAgIGxldCByZXNvdXJjZSA9IHRoaXMuYmFzZVJlc291cmNlO1xuICAgIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWdtZW50cykge1xuICAgICAgcmVzb3VyY2UgPSByZXNvdXJjZS5hZGRSZXNvdXJjZShzZWdtZW50KTtcbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgZnVuY3Rpb24gbmFtZS9pZCBiYXNlZCBvbiBwYXRoICsgbWV0aG9kXG4gICAgY29uc3Qgc2FmZUlkID0gcGF0aFxuICAgICAgLnJlcGxhY2UoL1teYS16QS1aMC05XS9nLCAnLScpIC8vIHJlcGxhY2UgL3t9IHdpdGggLVxuICAgICAgLnJlcGxhY2UoLy0rL2csICctJylcbiAgICAgIC5yZXBsYWNlKC9eLXwtJC9nLCAnJyk7XG4gICAgY29uc3QgZm5JZCA9IGAke21ldGhvZH0tJHtzYWZlSWQgfHwgJ3Jvb3QnfS0ke3RoaXMubGFtYmRhSW5kZXgrK31gO1xuXG4gICAgY29uc3QgZm4gPSBuZXcgbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsIGZuSWQsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxuICAgICAgZW50cnk6IGhhbmRsZXJFbnRyeSxcbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAuLi5jb21tb25FbnYsXG4gICAgICAgIC4uLihleHRyYUVudiA/PyB7fSksXG4gICAgICB9LFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICBzb3VyY2VNYXA6IGZhbHNlLFxuICAgICAgICB0YXJnZXQ6ICdlczIwMjInLFxuICAgICAgICBmb3JtYXQ6IG5vZGVqcy5PdXRwdXRGb3JtYXQuQ0pTLFxuICAgICAgICBtYWluRmllbGRzOiBbJ21vZHVsZScsICdtYWluJ10sXG4gICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICdAYXdzLXNkay9jbGllbnQtczMnLFxuICAgICAgICAgICdAYXdzLXNkay9jbGllbnQtc2VjcmV0cy1tYW5hZ2VyJyxcbiAgICAgICAgICAnQGF3cy1zZGsvczMtcmVxdWVzdC1wcmVzaWduZXInLFxuICAgICAgICAgICdAYXdzLXNkay9jbGllbnQtcmRzLWRhdGEnLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGludGVncmF0aW9uID0gbmV3IGFwaWd3LkxhbWJkYUludGVncmF0aW9uKGZuKTtcblxuICAgIHJlc291cmNlLmFkZE1ldGhvZChtZXRob2QsIGludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemVyOiB0aGlzLmF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFRPRE86IFJFTU9WRSBJTiBQUk9EVUNUSU9OIC0gVGhlc2Ugc3VwcHJlc3Npb25zIGFyZSBmb3IgZGV2ZWxvcG1lbnQgb25seVxuICAvLyBFYWNoIHN1cHByZXNzaW9uIG5lZWRzIHRvIGJlIGFkZHJlc3NlZCBmb3IgcHJvZHVjdGlvbiBkZXBsb3ltZW50XG4gIHByaXZhdGUgYWRkQ2RrTmFnU3VwcHJlc3Npb25zKCk6IHZvaWQge1xuICAgIC8vIFN1cHByZXNzIEFMTCBDREsgTkFHIGVycm9ycyBmb3IgZGV2ZWxvcG1lbnQgZGVwbG95bWVudFxuICAgIC8vIFRPRE86IFJlbW92ZSB0aGVzZSBzdXBwcmVzc2lvbnMgYW5kIGZpeCBlYWNoIHNlY3VyaXR5IGlzc3VlIGZvciBwcm9kdWN0aW9uXG4gICAgTmFnU3VwcHJlc3Npb25zLmFkZFN0YWNrU3VwcHJlc3Npb25zKHRoaXMsIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtVlBDNycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFZQQyBGbG93IExvZ3Mgd2lsbCBiZSBhZGRlZCBpbiBwcm9kdWN0aW9uIGZvciBuZXR3b3JrIG1vbml0b3JpbmcnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtU01HNCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEFkZCBhdXRvbWF0aWMgc2VjcmV0IHJvdGF0aW9uIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUVDMjMnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBSZXN0cmljdCBkYXRhYmFzZSBhY2Nlc3MgdG8gc3BlY2lmaWMgSVAgcmFuZ2VzIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVJEUzMnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBFbmFibGUgTXVsdGktQVogZm9yIHByb2R1Y3Rpb24gaGlnaCBhdmFpbGFiaWxpdHknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUkRTMTAnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBFbmFibGUgZGVsZXRpb24gcHJvdGVjdGlvbiBmb3IgcHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1SRFMxMScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFVzZSBub24tZGVmYXVsdCBkYXRhYmFzZSBwb3J0IGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzEnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBTdHJlbmd0aGVuIHBhc3N3b3JkIHBvbGljeSB0byByZXF1aXJlIHNwZWNpYWwgY2hhcmFjdGVycycsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DT0cyJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogRW5hYmxlIE1GQSBmb3IgcHJvZHVjdGlvbiB1c2VyIGF1dGhlbnRpY2F0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzMnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBFbmFibGUgYWR2YW5jZWQgc2VjdXJpdHkgbW9kZSBmb3IgcHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DT0c0JyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQWRkIENvZ25pdG8gVXNlciBQb29sIGF1dGhvcml6ZXIgdG8gQVBJIEdhdGV3YXknLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUzEnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBFbmFibGUgUzMgc2VydmVyIGFjY2VzcyBsb2dnaW5nIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVMxMCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEFkZCBTU0wtb25seSBidWNrZXQgcG9saWNpZXMgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtTDEnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBVcGRhdGUgdG8gbGF0ZXN0IE5vZGUuanMgcnVudGltZSB2ZXJzaW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTQnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBSZXBsYWNlIEFXUyBtYW5hZ2VkIHBvbGljaWVzIHdpdGggY3VzdG9tIHBvbGljaWVzJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUlBTTUnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBSZW1vdmUgd2lsZGNhcmQgcGVybWlzc2lvbnMgYW5kIHVzZSBzcGVjaWZpYyByZXNvdXJjZSBBUk5zJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUcxJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogRW5hYmxlIEFQSSBHYXRld2F5IGFjY2VzcyBsb2dnaW5nIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUcyJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQWRkIHJlcXVlc3QgdmFsaWRhdGlvbiB0byBBUEkgR2F0ZXdheScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHMycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEFzc29jaWF0ZSBBUEkgR2F0ZXdheSB3aXRoIEFXUyBXQUYgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQVBJRzQnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBJbXBsZW1lbnQgQVBJIEdhdGV3YXkgYXV0aG9yaXphdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DRlIxJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQWRkIGdlbyByZXN0cmljdGlvbnMgaWYgbmVlZGVkIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjInLFxuICAgICAgICByZWFzb246ICdUT0RPOiBJbnRlZ3JhdGUgQ2xvdWRGcm9udCB3aXRoIEFXUyBXQUYgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSMycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBDbG91ZEZyb250IGFjY2VzcyBsb2dnaW5nIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjQnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBVcGRhdGUgQ2xvdWRGcm9udCB0byB1c2UgVExTIDEuMisgbWluaW11bScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DRlI3JyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogVXNlIE9yaWdpbiBBY2Nlc3MgQ29udHJvbCBpbnN0ZWFkIG9mIE9BSScsXG4gICAgICB9LFxuICAgIF0pO1xuICB9XG59XG4iXX0=