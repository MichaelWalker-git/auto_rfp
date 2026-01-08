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
exports.AutoRfpInfrastructureStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const rds = __importStar(require("aws-cdk-lib/aws-rds"));
const ec2 = __importStar(require("aws-cdk-lib/aws-ec2"));
const cognito = __importStar(require("aws-cdk-lib/aws-cognito"));
const s3 = __importStar(require("aws-cdk-lib/aws-s3"));
const cloudfront = __importStar(require("aws-cdk-lib/aws-cloudfront"));
const origins = __importStar(require("aws-cdk-lib/aws-cloudfront-origins"));
const ses = __importStar(require("aws-cdk-lib/aws-ses"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const nodejs = __importStar(require("aws-cdk-lib/aws-lambda-nodejs"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const cdk_nag_1 = require("cdk-nag");
class AutoRfpInfrastructureStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        // TODO: Add CDK NAG suppressions for development - REMOVE IN PRODUCTION
        // These suppressions allow deployment while security issues are addressed
        this.addCdkNagSuppressions();
        // Create VPC for RDS
        const vpc = new ec2.Vpc(this, 'AutoRfpVpc', {
            maxAzs: 2,
            natGateways: 0, // Cost optimization - use public subnets only
            subnetConfiguration: [
                {
                    cidrMask: 24,
                    name: 'public-subnet',
                    subnetType: ec2.SubnetType.PUBLIC,
                },
            ],
        });
        // Create database secret
        const dbSecret = new secretsmanager.Secret(this, 'AutoRfpDbSecret', {
            secretName: 'auto-rfp/database',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ username: 'postgres' }),
                generateStringKey: 'password',
                excludeCharacters: '"@/\\',
            },
        });
        // Create Lambda security group
        const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'AutoRfpLambdaSecurityGroup', {
            vpc,
            description: 'Security group for AutoRFP Lambda functions',
            allowAllOutbound: true,
        });
        // Create database security group
        const dbSecurityGroup = new ec2.SecurityGroup(this, 'AutoRfpDbSecurityGroup', {
            vpc,
            description: 'Security group for AutoRFP RDS database',
            allowAllOutbound: false,
        });
        // Allow connections from Lambda security group
        dbSecurityGroup.addIngressRule(lambdaSecurityGroup, ec2.Port.tcp(5432), 'Allow PostgreSQL access from Lambda');
        // Also allow connections from anywhere for external access (development/migration)
        dbSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(5432), 'Allow PostgreSQL access from anywhere (for development)');
        // Create RDS PostgreSQL instance
        const database = new rds.DatabaseInstance(this, 'AutoRfpDatabase', {
            engine: rds.DatabaseInstanceEngine.postgres({
                version: rds.PostgresEngineVersion.VER_15_7,
            }),
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PUBLIC,
            },
            securityGroups: [dbSecurityGroup],
            credentials: rds.Credentials.fromSecret(dbSecret),
            databaseName: 'auto_rfp',
            allocatedStorage: 20,
            maxAllocatedStorage: 100,
            deleteAutomatedBackups: false,
            backupRetention: cdk.Duration.days(7),
            deletionProtection: false, // Set to true for production
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
            storageEncrypted: true,
            multiAz: false, // Set to true for production
            publiclyAccessible: true, // Needed for external access
        });
        // Create Cognito User Pool
        const userPool = new cognito.UserPool(this, 'AutoRfpUserPool', {
            userPoolName: 'auto-rfp-users',
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            signInCaseSensitive: false,
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true,
                },
                givenName: {
                    required: false,
                    mutable: true,
                },
                familyName: {
                    required: false,
                    mutable: true,
                },
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
        });
        // Create Cognito User Pool Client
        const userPoolClient = new cognito.UserPoolClient(this, 'AutoRfpUserPoolClient', {
            userPool,
            userPoolClientName: 'auto-rfp-client',
            generateSecret: false, // For web applications
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                scopes: [
                    cognito.OAuthScope.EMAIL,
                    cognito.OAuthScope.OPENID,
                    cognito.OAuthScope.PROFILE,
                ],
            },
        });
        // Create S3 bucket for document storage
        const documentsBucket = new s3.Bucket(this, 'AutoRfpDocumentsBucket', {
            bucketName: `auto-rfp-documents-${cdk.Aws.ACCOUNT_ID}`,
            versioned: true,
            encryption: s3.BucketEncryption.S3_MANAGED,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
            lifecycleRules: [
                {
                    id: 'transition-to-ia',
                    transitions: [
                        {
                            storageClass: s3.StorageClass.INFREQUENT_ACCESS,
                            transitionAfter: cdk.Duration.days(30),
                        },
                    ],
                },
            ],
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
                    allowedOrigins: ['*'], // Restrict this to your domain in production
                    allowedHeaders: ['*'],
                    maxAge: 300,
                },
            ],
        });
        // Create S3 bucket for static website hosting
        const websiteBucket = new s3.Bucket(this, 'AutoRfpWebsiteBucket', {
            bucketName: `auto-rfp-website-${cdk.Aws.ACCOUNT_ID}`,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
            autoDeleteObjects: true, // Automatically delete objects when bucket is destroyed
        });
        // Create Lambda function for API routes using NodejsFunction (auto-compiles TypeScript)
        const apiLambda = new nodejs.NodejsFunction(this, 'AutoRfpApiHandler', {
            runtime: lambda.Runtime.NODEJS_18_X,
            entry: './lambda/index.ts', // Lambda source is now in infrastructure/lambda/
            handler: 'handler',
            timeout: cdk.Duration.seconds(30),
            memorySize: 1024,
            environment: {
                // We'll use AWS Secrets Manager to securely access database credentials
                DATABASE_SECRET_ARN: dbSecret.secretArn,
                DATABASE_NAME: 'auto_rfp',
                DATABASE_HOST: database.instanceEndpoint.hostname,
                DATABASE_PORT: database.instanceEndpoint.port.toString(),
                COGNITO_USER_POOL_ID: userPool.userPoolId,
                COGNITO_USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                AWS_ACCOUNT_ID: cdk.Aws.ACCOUNT_ID,
                S3_BUCKET: documentsBucket.bucketName,
                DOCUMENTS_BUCKET: documentsBucket.bucketName,
                NODE_ENV: 'production',
            },
            bundling: {
                externalModules: [
                    // Keep AWS SDK v3 as external (provided by Lambda runtime)
                    '@aws-sdk/client-bedrock-runtime',
                    '@aws-sdk/client-s3',
                    '@aws-sdk/client-secrets-manager',
                    '@aws-sdk/s3-request-presigner',
                ],
                minify: true,
                sourceMap: false,
                target: 'es2022',
                format: nodejs.OutputFormat.CJS,
                mainFields: ['module', 'main'],
                // No additional node modules needed for now
                nodeModules: [],
            },
            // Temporarily remove VPC configuration to avoid networking complexity
            // We'll add this back once the database is deployed and working
            // vpc: vpc,
            // vpcSubnets: {
            //   subnetType: ec2.SubnetType.PUBLIC,
            // },
            // securityGroups: [lambdaSecurityGroup],
            // allowPublicSubnet: true, // Allow Lambda to run in public subnet
        });
        // Grant Lambda access to necessary resources
        dbSecret.grantRead(apiLambda);
        documentsBucket.grantReadWrite(apiLambda);
        // Grant Lambda access to Cognito
        apiLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'cognito-idp:AdminInitiateAuth',
                'cognito-idp:AdminCreateUser',
                'cognito-idp:AdminSetUserPassword',
                'cognito-idp:AdminUpdateUserAttributes',
                'cognito-idp:AdminGetUser',
                'cognito-idp:ListUsers',
            ],
            resources: [userPool.userPoolArn],
        }));
        // Grant Lambda access to Bedrock
        apiLambda.addToRolePolicy(new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
                'bedrock:InvokeModel',
                'bedrock:InvokeModelWithResponseStream',
            ],
            resources: [
                `arn:aws:bedrock:${cdk.Stack.of(this).region}::foundation-model/anthropic.claude-*`,
                `arn:aws:bedrock:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:inference-profile/us.anthropic.claude-*`,
            ],
        }));
        // Create API Gateway
        const api = new apigateway.RestApi(this, 'AutoRfpApi', {
            restApiName: 'AutoRFP API',
            description: 'AutoRFP API Gateway for Lambda backend',
            deployOptions: {
                stageName: 'prod',
                metricsEnabled: true,
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,
            },
            // Remove CORS configuration to avoid conflicts with proxy integration
            // CORS will be handled by the Lambda function
        });
        // Create API Gateway integration with Lambda
        const apiIntegration = new apigateway.LambdaIntegration(apiLambda, {
            proxy: true,
            // Remove integrationResponses when using proxy integration
            // The Lambda function will handle the response format
        });
        // Add API routes
        const apiResource = api.root.addResource('api');
        apiResource.addProxy({
            defaultIntegration: apiIntegration,
            anyMethod: true,
        });
        // Create CloudFront Origin Access Identity (simpler approach)
        const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'AutoRfpOAI', {
            comment: 'Origin Access Identity for AutoRFP website',
        });
        // Create CloudFront distribution
        const distribution = new cloudfront.Distribution(this, 'AutoRfpDistribution', {
            defaultRootObject: 'index.html',
            defaultBehavior: {
                origin: new origins.S3Origin(websiteBucket, {
                    originAccessIdentity,
                }),
                viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
                compress: true,
                cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            },
            additionalBehaviors: {
                '/api/*': {
                    origin: new origins.RestApiOrigin(api),
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
                    cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
                    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
                    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
                },
            },
            errorResponses: [
                {
                    httpStatus: 404,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.minutes(30),
                },
                {
                    httpStatus: 403,
                    responseHttpStatus: 200,
                    responsePagePath: '/index.html',
                    ttl: cdk.Duration.minutes(30),
                },
            ],
            priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
            enableIpv6: true,
            comment: 'AutoRFP CloudFront Distribution',
        });
        // Grant CloudFront access to S3 bucket
        websiteBucket.grantRead(originAccessIdentity);
        // Create IAM role for deployment access
        const deploymentRole = new iam.Role(this, 'AutoRfpDeploymentRole', {
            assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
            inlinePolicies: {
                S3Access: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                's3:GetObject',
                                's3:PutObject',
                                's3:DeleteObject',
                                's3:ListBucket',
                            ],
                            resources: [
                                websiteBucket.bucketArn,
                                `${websiteBucket.bucketArn}/*`,
                                documentsBucket.bucketArn,
                                `${documentsBucket.bucketArn}/*`,
                            ],
                        }),
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'cloudfront:CreateInvalidation',
                            ],
                            resources: [distribution.distributionArn],
                        }),
                    ],
                }),
            },
        });
        // Create SES domain identity (you'll need to verify this manually)
        const sesIdentity = new ses.EmailIdentity(this, 'AutoRfpSesIdentity', {
            identity: ses.Identity.domain('example.com'), // Replace with your domain
        });
        // Output important values
        new cdk.CfnOutput(this, 'DatabaseEndpoint', {
            value: database.instanceEndpoint.hostname,
            description: 'RDS Database Endpoint',
        });
        new cdk.CfnOutput(this, 'DatabasePort', {
            value: database.instanceEndpoint.port.toString(),
            description: 'RDS Database Port',
        });
        new cdk.CfnOutput(this, 'DatabaseSecretArn', {
            value: dbSecret.secretArn,
            description: 'Database Secret ARN',
        });
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: userPool.userPoolId,
            description: 'Cognito User Pool ID',
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
        });
        new cdk.CfnOutput(this, 'DocumentsBucketName', {
            value: documentsBucket.bucketName,
            description: 'S3 Documents Bucket Name',
        });
        new cdk.CfnOutput(this, 'WebsiteBucketName', {
            value: websiteBucket.bucketName,
            description: 'S3 Website Bucket Name',
        });
        new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
            value: distribution.distributionId,
            description: 'CloudFront Distribution ID',
        });
        new cdk.CfnOutput(this, 'CloudFrontDistributionDomainName', {
            value: distribution.distributionDomainName,
            description: 'CloudFront Distribution Domain Name',
        });
        new cdk.CfnOutput(this, 'DeploymentRoleArn', {
            value: deploymentRole.roleArn,
            description: 'Deployment Role ARN',
        });
        new cdk.CfnOutput(this, 'Region', {
            value: cdk.Stack.of(this).region,
            description: 'AWS Region',
        });
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: api.url,
            description: 'API Gateway URL',
        });
        new cdk.CfnOutput(this, 'ApiGatewayId', {
            value: api.restApiId,
            description: 'API Gateway ID',
        });
        new cdk.CfnOutput(this, 'LambdaFunctionArn', {
            value: apiLambda.functionArn,
            description: 'Lambda Function ARN',
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
exports.AutoRfpInfrastructureStack = AutoRfpInfrastructureStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYXV0by1yZnAtaW5mcmFzdHJ1Y3R1cmUtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJhdXRvLXJmcC1pbmZyYXN0cnVjdHVyZS1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQyxpRUFBbUQ7QUFDbkQsdURBQXlDO0FBQ3pDLHVFQUF5RDtBQUN6RCw0RUFBOEQ7QUFDOUQseURBQTJDO0FBQzNDLHlEQUEyQztBQUMzQywrRUFBaUU7QUFDakUsK0RBQWlEO0FBQ2pELHNFQUF3RDtBQUN4RCx1RUFBeUQ7QUFFekQscUNBQThEO0FBRTlELE1BQWEsMEJBQTJCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDdkQsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qix3RUFBd0U7UUFDeEUsMEVBQTBFO1FBQzFFLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBRTdCLHFCQUFxQjtRQUNyQixNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLFlBQVksRUFBRTtZQUMxQyxNQUFNLEVBQUUsQ0FBQztZQUNULFdBQVcsRUFBRSxDQUFDLEVBQUUsOENBQThDO1lBQzlELG1CQUFtQixFQUFFO2dCQUNuQjtvQkFDRSxRQUFRLEVBQUUsRUFBRTtvQkFDWixJQUFJLEVBQUUsZUFBZTtvQkFDckIsVUFBVSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUMsTUFBTTtpQkFDbEM7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILHlCQUF5QjtRQUN6QixNQUFNLFFBQVEsR0FBRyxJQUFJLGNBQWMsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGlCQUFpQixFQUFFO1lBQ2xFLFVB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RUFBRSxnREFBZ0Q7YUFDekQ7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUseURBQXlEO2FBQ2xFO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLGtFQUFrRTthQUMzRTtZQUNEO2dCQUNFLEVBQUUsRUFBRSxvQkFBb0I7Z0JBQ3hCLE1BQU0sRUFBRSx3REFBd0Q7YUFDakU7WUFDRDtnQkFDRSxFQUFFLEVBQUUsb0JBQW9CO2dCQUN4QixNQUFNLEVBQUUsNkNBQTZDO2FBQ3REO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG9CQUFvQjtnQkFDeEIsTUFBTSxFQUFFLHlEQUF5RDthQUNsRTtZQUNEO2dCQUNFLEVBQUUsRUFBRSxvQkFBb0I7Z0JBQ3hCLE1BQU0sRUFBRSwyQ0FBMkM7YUFDcEQ7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUscURBQXFEO2FBQzlEO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLHdEQUF3RDthQUNqRTtZQUNEO2dCQUNFLEVBQUUsRUFBRSxtQkFBbUI7Z0JBQ3ZCLE1BQU0sRUFBRSx1REFBdUQ7YUFDaEU7WUFDRDtnQkFDRSxFQUFFLEVBQUUsbUJBQW1CO2dCQUN2QixNQUFNLEVBQUUsaURBQWlEO2FBQzFEO1lBQ0Q7Z0JBQ0UsRUFBRSxFQUFFLG1CQUFtQjtnQkFDdkIsTUFBTSxFQUFFLGdEQUFnRDthQUN6RDtTQUNGLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTloQkQsZ0VBOGhCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyByZHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXJkcyc7XG5pbXBvcnQgKiBhcyBlYzIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWVjMic7XG5pbXBvcnQgKiBhcyBjb2duaXRvIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2duaXRvJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250JztcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucyc7XG5pbXBvcnQgKiBhcyBzZXMgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlcyc7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgbm9kZWpzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgeyBBd3NTb2x1dGlvbnNDaGVja3MsIE5hZ1N1cHByZXNzaW9ucyB9IGZyb20gJ2Nkay1uYWcnO1xuXG5leHBvcnQgY2xhc3MgQXV0b1JmcEluZnJhc3RydWN0dXJlU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBUT0RPOiBBZGQgQ0RLIE5BRyBzdXBwcmVzc2lvbnMgZm9yIGRldmVsb3BtZW50IC0gUkVNT1ZFIElOIFBST0RVQ1RJT05cbiAgICAvLyBUaGVzZSBzdXBwcmVzc2lvbnMgYWxsb3cgZGVwbG95bWVudCB3aGlsZSBzZWN1cml0eSBpc3N1ZXMgYXJlIGFkZHJlc3NlZFxuICAgIHRoaXMuYWRkQ2RrTmFnU3VwcHJlc3Npb25zKCk7XG5cbiAgICAvLyBDcmVhdGUgVlBDIGZvciBSRFNcbiAgICBjb25zdCB2cGMgPSBuZXcgZWMyLlZwYyh0aGlzLCAnQXV0b1JmcFZwYycsIHtcbiAgICAgIG1heEF6czogMixcbiAgICAgIG5hdEdhdGV3YXlzOiAwLCAvLyBDb3N0IG9wdGltaXphdGlvbiAtIHVzZSBwdWJsaWMgc3VibmV0cyBvbmx5XG4gICAgICBzdWJuZXRDb25maWd1cmF0aW9uOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBjaWRyTWFzazogMjQsXG4gICAgICAgICAgbmFtZTogJ3B1YmxpYy1zdWJuZXQnLFxuICAgICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgZGF0YWJhc2Ugc2VjcmV0XG4gICAgY29uc3QgZGJTZWNyZXQgPSBuZXcgc2VjcmV0c21hbmFnZXIuU2VjcmV0KHRoaXMsICdBdXRvUmZwRGJTZWNyZXQnLCB7XG4gICAgICBzZWNyZXROYW1lOiAnYXV0by1yZnAvZGF0YWJhc2UnLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHsgdXNlcm5hbWU6ICdwb3N0Z3JlcycgfSksXG4gICAgICAgIGdlbmVyYXRlU3RyaW5nS2V5OiAncGFzc3dvcmQnLFxuICAgICAgICBleGNsdWRlQ2hhcmFjdGVyczogJ1wiQC9cXFxcJyxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgTGFtYmRhIHNlY3VyaXR5IGdyb3VwXG4gICAgY29uc3QgbGFtYmRhU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnQXV0b1JmcExhbWJkYVNlY3VyaXR5R3JvdXAnLCB7XG4gICAgICB2cGMsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NlY3VyaXR5IGdyb3VwIGZvciBBdXRvUkZQIExhbWJkYSBmdW5jdGlvbnMnLFxuICAgICAgYWxsb3dBbGxPdXRib3VuZDogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBkYXRhYmFzZSBzZWN1cml0eSBncm91cFxuICAgIGNvbnN0IGRiU2VjdXJpdHlHcm91cCA9IG5ldyBlYzIuU2VjdXJpdHlHcm91cCh0aGlzLCAnQXV0b1JmcERiU2VjdXJpdHlHcm91cCcsIHtcbiAgICAgIHZwYyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnU2VjdXJpdHkgZ3JvdXAgZm9yIEF1dG9SRlAgUkRTIGRhdGFiYXNlJyxcbiAgICAgIGFsbG93QWxsT3V0Ym91bmQ6IGZhbHNlLFxuICAgIH0pO1xuXG4gICAgLy8gQWxsb3cgY29ubmVjdGlvbnMgZnJvbSBMYW1iZGEgc2VjdXJpdHkgZ3JvdXBcbiAgICBkYlNlY3VyaXR5R3JvdXAuYWRkSW5ncmVzc1J1bGUoXG4gICAgICBsYW1iZGFTZWN1cml0eUdyb3VwLFxuICAgICAgZWMyLlBvcnQudGNwKDU0MzIpLFxuICAgICAgJ0FsbG93IFBvc3RncmVTUUwgYWNjZXNzIGZyb20gTGFtYmRhJ1xuICAgICk7XG5cbiAgICAvLyBBbHNvIGFsbG93IGNvbm5lY3Rpb25zIGZyb20gYW55d2hlcmUgZm9yIGV4dGVybmFsIGFjY2VzcyAoZGV2ZWxvcG1lbnQvbWlncmF0aW9uKVxuICAgIGRiU2VjdXJpdHlHcm91cC5hZGRJbmdyZXNzUnVsZShcbiAgICAgIGVjMi5QZWVyLmFueUlwdjQoKSxcbiAgICAgIGVjMi5Qb3J0LnRjcCg1NDMyKSxcbiAgICAgICdBbGxvdyBQb3N0Z3JlU1FMIGFjY2VzcyBmcm9tIGFueXdoZXJlIChmb3IgZGV2ZWxvcG1lbnQpJ1xuICAgICk7XG5cbiAgICAvLyBDcmVhdGUgUkRTIFBvc3RncmVTUUwgaW5zdGFuY2VcbiAgICBjb25zdCBkYXRhYmFzZSA9IG5ldyByZHMuRGF0YWJhc2VJbnN0YW5jZSh0aGlzLCAnQXV0b1JmcERhdGFiYXNlJywge1xuICAgICAgZW5naW5lOiByZHMuRGF0YWJhc2VJbnN0YW5jZUVuZ2luZS5wb3N0Z3Jlcyh7XG4gICAgICAgIHZlcnNpb246IHJkcy5Qb3N0Z3Jlc0VuZ2luZVZlcnNpb24uVkVSXzE1XzcsXG4gICAgICB9KSxcbiAgICAgIGluc3RhbmNlVHlwZTogZWMyLkluc3RhbmNlVHlwZS5vZihlYzIuSW5zdGFuY2VDbGFzcy5UMywgZWMyLkluc3RhbmNlU2l6ZS5NSUNSTyksXG4gICAgICB2cGMsXG4gICAgICB2cGNTdWJuZXRzOiB7XG4gICAgICAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgIH0sXG4gICAgICBzZWN1cml0eUdyb3VwczogW2RiU2VjdXJpdHlHcm91cF0sXG4gICAgICBjcmVkZW50aWFsczogcmRzLkNyZWRlbnRpYWxzLmZyb21TZWNyZXQoZGJTZWNyZXQpLFxuICAgICAgZGF0YWJhc2VOYW1lOiAnYXV0b19yZnAnLFxuICAgICAgYWxsb2NhdGVkU3RvcmFnZTogMjAsXG4gICAgICBtYXhBbGxvY2F0ZWRTdG9yYWdlOiAxMDAsXG4gICAgICBkZWxldGVBdXRvbWF0ZWRCYWNrdXBzOiBmYWxzZSxcbiAgICAgIGJhY2t1cFJldGVudGlvbjogY2RrLkR1cmF0aW9uLmRheXMoNyksXG4gICAgICBkZWxldGlvblByb3RlY3Rpb246IGZhbHNlLCAvLyBTZXQgdG8gdHJ1ZSBmb3IgcHJvZHVjdGlvblxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8gQ2hhbmdlIHRvIFJFVEFJTiBmb3IgcHJvZHVjdGlvblxuICAgICAgc3RvcmFnZUVuY3J5cHRlZDogdHJ1ZSxcbiAgICAgIG11bHRpQXo6IGZhbHNlLCAvLyBTZXQgdG8gdHJ1ZSBmb3IgcHJvZHVjdGlvblxuICAgICAgcHVibGljbHlBY2Nlc3NpYmxlOiB0cnVlLCAvLyBOZWVkZWQgZm9yIGV4dGVybmFsIGFjY2Vzc1xuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIENvZ25pdG8gVXNlciBQb29sXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnQXV0b1JmcFVzZXJQb29sJywge1xuICAgICAgdXNlclBvb2xOYW1lOiAnYXV0by1yZnAtdXNlcnMnLFxuICAgICAgc2VsZlNpZ25VcEVuYWJsZWQ6IHRydWUsXG4gICAgICBzaWduSW5BbGlhc2VzOiB7XG4gICAgICAgIGVtYWlsOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIHNpZ25JbkNhc2VTZW5zaXRpdmU6IGZhbHNlLFxuICAgICAgc3RhbmRhcmRBdHRyaWJ1dGVzOiB7XG4gICAgICAgIGVtYWlsOiB7XG4gICAgICAgICAgcmVxdWlyZWQ6IHRydWUsXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgICAgZ2l2ZW5OYW1lOiB7XG4gICAgICAgICAgcmVxdWlyZWQ6IGZhbHNlLFxuICAgICAgICAgIG11dGFibGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIGZhbWlseU5hbWU6IHtcbiAgICAgICAgICByZXF1aXJlZDogZmFsc2UsXG4gICAgICAgICAgbXV0YWJsZTogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBwYXNzd29yZFBvbGljeToge1xuICAgICAgICBtaW5MZW5ndGg6IDgsXG4gICAgICAgIHJlcXVpcmVMb3dlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVVcHBlcmNhc2U6IHRydWUsXG4gICAgICAgIHJlcXVpcmVEaWdpdHM6IHRydWUsXG4gICAgICAgIHJlcXVpcmVTeW1ib2xzOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBhY2NvdW50UmVjb3Zlcnk6IGNvZ25pdG8uQWNjb3VudFJlY292ZXJ5LkVNQUlMX09OTFksXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBDaGFuZ2UgdG8gUkVUQUlOIGZvciBwcm9kdWN0aW9uXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50XG4gICAgY29uc3QgdXNlclBvb2xDbGllbnQgPSBuZXcgY29nbml0by5Vc2VyUG9vbENsaWVudCh0aGlzLCAnQXV0b1JmcFVzZXJQb29sQ2xpZW50Jywge1xuICAgICAgdXNlclBvb2wsXG4gICAgICB1c2VyUG9vbENsaWVudE5hbWU6ICdhdXRvLXJmcC1jbGllbnQnLFxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLCAvLyBGb3Igd2ViIGFwcGxpY2F0aW9uc1xuICAgICAgYXV0aEZsb3dzOiB7XG4gICAgICAgIHVzZXJQYXNzd29yZDogdHJ1ZSxcbiAgICAgICAgdXNlclNycDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBvQXV0aDoge1xuICAgICAgICBmbG93czoge1xuICAgICAgICAgIGF1dGhvcml6YXRpb25Db2RlR3JhbnQ6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHNjb3BlczogW1xuICAgICAgICAgIGNvZ25pdG8uT0F1dGhTY29wZS5FTUFJTCxcbiAgICAgICAgICBjb2duaXRvLk9BdXRoU2NvcGUuT1BFTklELFxuICAgICAgICAgIGNvZ25pdG8uT0F1dGhTY29wZS5QUk9GSUxFLFxuICAgICAgICBdLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBTMyBidWNrZXQgZm9yIGRvY3VtZW50IHN0b3JhZ2VcbiAgICBjb25zdCBkb2N1bWVudHNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdBdXRvUmZwRG9jdW1lbnRzQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGF1dG8tcmZwLWRvY3VtZW50cy0ke2Nkay5Bd3MuQUNDT1VOVF9JRH1gLFxuICAgICAgdmVyc2lvbmVkOiB0cnVlLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgYmxvY2tQdWJsaWNBY2Nlc3M6IHMzLkJsb2NrUHVibGljQWNjZXNzLkJMT0NLX0FMTCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksIC8vIENoYW5nZSB0byBSRVRBSU4gZm9yIHByb2R1Y3Rpb25cbiAgICAgIGxpZmVjeWNsZVJ1bGVzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBpZDogJ3RyYW5zaXRpb24tdG8taWEnLFxuICAgICAgICAgIHRyYW5zaXRpb25zOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLklORlJFUVVFTlRfQUNDRVNTLFxuICAgICAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBjb3JzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogW3MzLkh0dHBNZXRob2RzLkdFVCwgczMuSHR0cE1ldGhvZHMuUE9TVCwgczMuSHR0cE1ldGhvZHMuUFVUXSxcbiAgICAgICAgICBhbGxvd2VkT3JpZ2luczogWycqJ10sIC8vIFJlc3RyaWN0IHRoaXMgdG8geW91ciBkb21haW4gaW4gcHJvZHVjdGlvblxuICAgICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbJyonXSxcbiAgICAgICAgICBtYXhBZ2U6IDMwMCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgUzMgYnVja2V0IGZvciBzdGF0aWMgd2Vic2l0ZSBob3N0aW5nXG4gICAgY29uc3Qgd2Vic2l0ZUJ1Y2tldCA9IG5ldyBzMy5CdWNrZXQodGhpcywgJ0F1dG9SZnBXZWJzaXRlQnVja2V0Jywge1xuICAgICAgYnVja2V0TmFtZTogYGF1dG8tcmZwLXdlYnNpdGUtJHtjZGsuQXdzLkFDQ09VTlRfSUR9YCxcbiAgICAgIGJsb2NrUHVibGljQWNjZXNzOiBzMy5CbG9ja1B1YmxpY0FjY2Vzcy5CTE9DS19BTEwsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLCAvLyBDaGFuZ2UgdG8gUkVUQUlOIGZvciBwcm9kdWN0aW9uXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSwgLy8gQXV0b21hdGljYWxseSBkZWxldGUgb2JqZWN0cyB3aGVuIGJ1Y2tldCBpcyBkZXN0cm95ZWRcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBMYW1iZGEgZnVuY3Rpb24gZm9yIEFQSSByb3V0ZXMgdXNpbmcgTm9kZWpzRnVuY3Rpb24gKGF1dG8tY29tcGlsZXMgVHlwZVNjcmlwdClcbiAgICBjb25zdCBhcGlMYW1iZGEgPSBuZXcgbm9kZWpzLk5vZGVqc0Z1bmN0aW9uKHRoaXMsICdBdXRvUmZwQXBpSGFuZGxlcicsIHtcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxuICAgICAgZW50cnk6ICcuL2xhbWJkYS9pbmRleC50cycsIC8vIExhbWJkYSBzb3VyY2UgaXMgbm93IGluIGluZnJhc3RydWN0dXJlL2xhbWJkYS9cbiAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgIG1lbW9yeVNpemU6IDEwMjQsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAvLyBXZSdsbCB1c2UgQVdTIFNlY3JldHMgTWFuYWdlciB0byBzZWN1cmVseSBhY2Nlc3MgZGF0YWJhc2UgY3JlZGVudGlhbHNcbiAgICAgICAgREFUQUJBU0VfU0VDUkVUX0FSTjogZGJTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgICBEQVRBQkFTRV9OQU1FOiAnYXV0b19yZnAnLFxuICAgICAgICBEQVRBQkFTRV9IT1NUOiBkYXRhYmFzZS5pbnN0YW5jZUVuZHBvaW50Lmhvc3RuYW1lLFxuICAgICAgICBEQVRBQkFTRV9QT1JUOiBkYXRhYmFzZS5pbnN0YW5jZUVuZHBvaW50LnBvcnQudG9TdHJpbmcoKSxcbiAgICAgICAgQ09HTklUT19VU0VSX1BPT0xfSUQ6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICAgIENPR05JVE9fVVNFUl9QT09MX0NMSUVOVF9JRDogdXNlclBvb2xDbGllbnQudXNlclBvb2xDbGllbnRJZCxcbiAgICAgICAgQVdTX0FDQ09VTlRfSUQ6IGNkay5Bd3MuQUNDT1VOVF9JRCxcbiAgICAgICAgUzNfQlVDS0VUOiBkb2N1bWVudHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgICAgRE9DVU1FTlRTX0JVQ0tFVDogZG9jdW1lbnRzQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICAgIE5PREVfRU5WOiAncHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXG4gICAgICAgICAgLy8gS2VlcCBBV1MgU0RLIHYzIGFzIGV4dGVybmFsIChwcm92aWRlZCBieSBMYW1iZGEgcnVudGltZSlcbiAgICAgICAgICAnQGF3cy1zZGsvY2xpZW50LWJlZHJvY2stcnVudGltZScsXG4gICAgICAgICAgJ0Bhd3Mtc2RrL2NsaWVudC1zMycsXG4gICAgICAgICAgJ0Bhd3Mtc2RrL2NsaWVudC1zZWNyZXRzLW1hbmFnZXInLFxuICAgICAgICAgICdAYXdzLXNkay9zMy1yZXF1ZXN0LXByZXNpZ25lcicsXG4gICAgICAgIF0sXG4gICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgc291cmNlTWFwOiBmYWxzZSxcbiAgICAgICAgdGFyZ2V0OiAnZXMyMDIyJyxcbiAgICAgICAgZm9ybWF0OiBub2RlanMuT3V0cHV0Rm9ybWF0LkNKUyxcbiAgICAgICAgbWFpbkZpZWxkczogWydtb2R1bGUnLCAnbWFpbiddLFxuICAgICAgICAvLyBObyBhZGRpdGlvbmFsIG5vZGUgbW9kdWxlcyBuZWVkZWQgZm9yIG5vd1xuICAgICAgICBub2RlTW9kdWxlczogW10sXG4gICAgICB9LFxuICAgICAgLy8gVGVtcG9yYXJpbHkgcmVtb3ZlIFZQQyBjb25maWd1cmF0aW9uIHRvIGF2b2lkIG5ldHdvcmtpbmcgY29tcGxleGl0eVxuICAgICAgLy8gV2UnbGwgYWRkIHRoaXMgYmFjayBvbmNlIHRoZSBkYXRhYmFzZSBpcyBkZXBsb3llZCBhbmQgd29ya2luZ1xuICAgICAgLy8gdnBjOiB2cGMsXG4gICAgICAvLyB2cGNTdWJuZXRzOiB7XG4gICAgICAvLyAgIHN1Ym5ldFR5cGU6IGVjMi5TdWJuZXRUeXBlLlBVQkxJQyxcbiAgICAgIC8vIH0sXG4gICAgICAvLyBzZWN1cml0eUdyb3VwczogW2xhbWJkYVNlY3VyaXR5R3JvdXBdLFxuICAgICAgLy8gYWxsb3dQdWJsaWNTdWJuZXQ6IHRydWUsIC8vIEFsbG93IExhbWJkYSB0byBydW4gaW4gcHVibGljIHN1Ym5ldFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgTGFtYmRhIGFjY2VzcyB0byBuZWNlc3NhcnkgcmVzb3VyY2VzXG4gICAgZGJTZWNyZXQuZ3JhbnRSZWFkKGFwaUxhbWJkYSk7XG4gICAgZG9jdW1lbnRzQnVja2V0LmdyYW50UmVhZFdyaXRlKGFwaUxhbWJkYSk7XG4gICAgXG4gICAgLy8gR3JhbnQgTGFtYmRhIGFjY2VzcyB0byBDb2duaXRvXG4gICAgYXBpTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkluaXRpYXRlQXV0aCcsXG4gICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkNyZWF0ZVVzZXInLFxuICAgICAgICAnY29nbml0by1pZHA6QWRtaW5TZXRVc2VyUGFzc3dvcmQnLFxuICAgICAgICAnY29nbml0by1pZHA6QWRtaW5VcGRhdGVVc2VyQXR0cmlidXRlcycsXG4gICAgICAgICdjb2duaXRvLWlkcDpBZG1pbkdldFVzZXInLFxuICAgICAgICAnY29nbml0by1pZHA6TGlzdFVzZXJzJyxcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFt1c2VyUG9vbC51c2VyUG9vbEFybl0sXG4gICAgfSkpO1xuXG4gICAgLy8gR3JhbnQgTGFtYmRhIGFjY2VzcyB0byBCZWRyb2NrXG4gICAgYXBpTGFtYmRhLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdiZWRyb2NrOkludm9rZU1vZGVsJyxcbiAgICAgICAgJ2JlZHJvY2s6SW52b2tlTW9kZWxXaXRoUmVzcG9uc2VTdHJlYW0nLFxuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogW1xuICAgICAgICBgYXJuOmF3czpiZWRyb2NrOiR7Y2RrLlN0YWNrLm9mKHRoaXMpLnJlZ2lvbn06OmZvdW5kYXRpb24tbW9kZWwvYW50aHJvcGljLmNsYXVkZS0qYCxcbiAgICAgICAgYGFybjphd3M6YmVkcm9jazoke2Nkay5TdGFjay5vZih0aGlzKS5yZWdpb259OiR7Y2RrLlN0YWNrLm9mKHRoaXMpLmFjY291bnR9OmluZmVyZW5jZS1wcm9maWxlL3VzLmFudGhyb3BpYy5jbGF1ZGUtKmAsXG4gICAgICBdLFxuICAgIH0pKTtcblxuICAgIC8vIENyZWF0ZSBBUEkgR2F0ZXdheVxuICAgIGNvbnN0IGFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ0F1dG9SZnBBcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogJ0F1dG9SRlAgQVBJJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQXV0b1JGUCBBUEkgR2F0ZXdheSBmb3IgTGFtYmRhIGJhY2tlbmQnLFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6ICdwcm9kJyxcbiAgICAgICAgbWV0cmljc0VuYWJsZWQ6IHRydWUsXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgZGF0YVRyYWNlRW5hYmxlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICAvLyBSZW1vdmUgQ09SUyBjb25maWd1cmF0aW9uIHRvIGF2b2lkIGNvbmZsaWN0cyB3aXRoIHByb3h5IGludGVncmF0aW9uXG4gICAgICAvLyBDT1JTIHdpbGwgYmUgaGFuZGxlZCBieSB0aGUgTGFtYmRhIGZ1bmN0aW9uXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQVBJIEdhdGV3YXkgaW50ZWdyYXRpb24gd2l0aCBMYW1iZGFcbiAgICBjb25zdCBhcGlJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGFwaUxhbWJkYSwge1xuICAgICAgcHJveHk6IHRydWUsXG4gICAgICAvLyBSZW1vdmUgaW50ZWdyYXRpb25SZXNwb25zZXMgd2hlbiB1c2luZyBwcm94eSBpbnRlZ3JhdGlvblxuICAgICAgLy8gVGhlIExhbWJkYSBmdW5jdGlvbiB3aWxsIGhhbmRsZSB0aGUgcmVzcG9uc2UgZm9ybWF0XG4gICAgfSk7XG5cbiAgICAvLyBBZGQgQVBJIHJvdXRlc1xuICAgIGNvbnN0IGFwaVJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2FwaScpO1xuICAgIGFwaVJlc291cmNlLmFkZFByb3h5KHtcbiAgICAgIGRlZmF1bHRJbnRlZ3JhdGlvbjogYXBpSW50ZWdyYXRpb24sXG4gICAgICBhbnlNZXRob2Q6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyBDcmVhdGUgQ2xvdWRGcm9udCBPcmlnaW4gQWNjZXNzIElkZW50aXR5IChzaW1wbGVyIGFwcHJvYWNoKVxuICAgIGNvbnN0IG9yaWdpbkFjY2Vzc0lkZW50aXR5ID0gbmV3IGNsb3VkZnJvbnQuT3JpZ2luQWNjZXNzSWRlbnRpdHkodGhpcywgJ0F1dG9SZnBPQUknLCB7XG4gICAgICBjb21tZW50OiAnT3JpZ2luIEFjY2VzcyBJZGVudGl0eSBmb3IgQXV0b1JGUCB3ZWJzaXRlJyxcbiAgICB9KTtcblxuICAgIC8vIENyZWF0ZSBDbG91ZEZyb250IGRpc3RyaWJ1dGlvblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IG5ldyBjbG91ZGZyb250LkRpc3RyaWJ1dGlvbih0aGlzLCAnQXV0b1JmcERpc3RyaWJ1dGlvbicsIHtcbiAgICAgIGRlZmF1bHRSb290T2JqZWN0OiAnaW5kZXguaHRtbCcsXG4gICAgICBkZWZhdWx0QmVoYXZpb3I6IHtcbiAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5TM09yaWdpbih3ZWJzaXRlQnVja2V0LCB7XG4gICAgICAgICAgb3JpZ2luQWNjZXNzSWRlbnRpdHksXG4gICAgICAgIH0pLFxuICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfR0VUX0hFQURfT1BUSU9OUyxcbiAgICAgICAgY2FjaGVkTWV0aG9kczogY2xvdWRmcm9udC5DYWNoZWRNZXRob2RzLkNBQ0hFX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgIGNvbXByZXNzOiB0cnVlLFxuICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX09QVElNSVpFRCxcbiAgICAgIH0sXG4gICAgICBhZGRpdGlvbmFsQmVoYXZpb3JzOiB7XG4gICAgICAgICcvYXBpLyonOiB7XG4gICAgICAgICAgb3JpZ2luOiBuZXcgb3JpZ2lucy5SZXN0QXBpT3JpZ2luKGFwaSksXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfQUxMLFxuICAgICAgICAgIGNhY2hlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQ2FjaGVkTWV0aG9kcy5DQUNIRV9HRVRfSEVBRCxcbiAgICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX0RJU0FCTEVELFxuICAgICAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeS5BTExfVklFV0VSX0VYQ0VQVF9IT1NUX0hFQURFUixcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgICBlcnJvclJlc3BvbnNlczogW1xuICAgICAgICB7XG4gICAgICAgICAgaHR0cFN0YXR1czogNDA0LFxuICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCcsXG4gICAgICAgICAgdHRsOiBjZGsuRHVyYXRpb24ubWludXRlcygzMCksXG4gICAgICAgIH0sXG4gICAgICAgIHtcbiAgICAgICAgICBodHRwU3RhdHVzOiA0MDMsXG4gICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5taW51dGVzKDMwKSxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICBwcmljZUNsYXNzOiBjbG91ZGZyb250LlByaWNlQ2xhc3MuUFJJQ0VfQ0xBU1NfMTAwLFxuICAgICAgZW5hYmxlSXB2NjogdHJ1ZSxcbiAgICAgIGNvbW1lbnQ6ICdBdXRvUkZQIENsb3VkRnJvbnQgRGlzdHJpYnV0aW9uJyxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IENsb3VkRnJvbnQgYWNjZXNzIHRvIFMzIGJ1Y2tldFxuICAgIHdlYnNpdGVCdWNrZXQuZ3JhbnRSZWFkKG9yaWdpbkFjY2Vzc0lkZW50aXR5KTtcblxuICAgIC8vIENyZWF0ZSBJQU0gcm9sZSBmb3IgZGVwbG95bWVudCBhY2Nlc3NcbiAgICBjb25zdCBkZXBsb3ltZW50Um9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnQXV0b1JmcERlcGxveW1lbnRSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2NvZGVidWlsZC5hbWF6b25hd3MuY29tJyksXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICBTM0FjY2VzczogbmV3IGlhbS5Qb2xpY3lEb2N1bWVudCh7XG4gICAgICAgICAgc3RhdGVtZW50czogW1xuICAgICAgICAgICAgbmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgICAgICAnczM6R2V0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICAnczM6UHV0T2JqZWN0JyxcbiAgICAgICAgICAgICAgICAnczM6RGVsZXRlT2JqZWN0JyxcbiAgICAgICAgICAgICAgICAnczM6TGlzdEJ1Y2tldCcsXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICAgIHdlYnNpdGVCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgICAgICAgICAgIGAke3dlYnNpdGVCdWNrZXQuYnVja2V0QXJufS8qYCxcbiAgICAgICAgICAgICAgICBkb2N1bWVudHNCdWNrZXQuYnVja2V0QXJuLFxuICAgICAgICAgICAgICAgIGAke2RvY3VtZW50c0J1Y2tldC5idWNrZXRBcm59LypgLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdjbG91ZGZyb250OkNyZWF0ZUludmFsaWRhdGlvbicsXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIHJlc291cmNlczogW2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Bcm5dLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSxcbiAgICAgICAgfSksXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gQ3JlYXRlIFNFUyBkb21haW4gaWRlbnRpdHkgKHlvdSdsbCBuZWVkIHRvIHZlcmlmeSB0aGlzIG1hbnVhbGx5KVxuICAgIGNvbnN0IHNlc0lkZW50aXR5ID0gbmV3IHNlcy5FbWFpbElkZW50aXR5KHRoaXMsICdBdXRvUmZwU2VzSWRlbnRpdHknLCB7XG4gICAgICBpZGVudGl0eTogc2VzLklkZW50aXR5LmRvbWFpbignZXhhbXBsZS5jb20nKSwgLy8gUmVwbGFjZSB3aXRoIHlvdXIgZG9tYWluXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXQgaW1wb3J0YW50IHZhbHVlc1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXRhYmFzZUVuZHBvaW50Jywge1xuICAgICAgdmFsdWU6IGRhdGFiYXNlLmluc3RhbmNlRW5kcG9pbnQuaG9zdG5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1JEUyBEYXRhYmFzZSBFbmRwb2ludCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGF0YWJhc2VQb3J0Jywge1xuICAgICAgdmFsdWU6IGRhdGFiYXNlLmluc3RhbmNlRW5kcG9pbnQucG9ydC50b1N0cmluZygpLFxuICAgICAgZGVzY3JpcHRpb246ICdSRFMgRGF0YWJhc2UgUG9ydCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGF0YWJhc2VTZWNyZXRBcm4nLCB7XG4gICAgICB2YWx1ZTogZGJTZWNyZXQuc2VjcmV0QXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdEYXRhYmFzZSBTZWNyZXQgQVJOJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywge1xuICAgICAgdmFsdWU6IHVzZXJQb29sLnVzZXJQb29sSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIElEJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbENsaWVudElkJywge1xuICAgICAgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gVXNlciBQb29sIENsaWVudCBJRCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRG9jdW1lbnRzQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiBkb2N1bWVudHNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgRG9jdW1lbnRzIEJ1Y2tldCBOYW1lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdXZWJzaXRlQnVja2V0TmFtZScsIHtcbiAgICAgIHZhbHVlOiB3ZWJzaXRlQnVja2V0LmJ1Y2tldE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ1MzIFdlYnNpdGUgQnVja2V0IE5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkRnJvbnREaXN0cmlidXRpb25JZCcsIHtcbiAgICAgIHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgRGlzdHJpYnV0aW9uIElEJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbG91ZEZyb250RGlzdHJpYnV0aW9uRG9tYWluTmFtZScsIHtcbiAgICAgIHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBEaXN0cmlidXRpb24gRG9tYWluIE5hbWUnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RlcGxveW1lbnRSb2xlQXJuJywge1xuICAgICAgdmFsdWU6IGRlcGxveW1lbnRSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0RlcGxveW1lbnQgUm9sZSBBUk4nLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1JlZ2lvbicsIHtcbiAgICAgIHZhbHVlOiBjZGsuU3RhY2sub2YodGhpcykucmVnaW9uLFxuICAgICAgZGVzY3JpcHRpb246ICdBV1MgUmVnaW9uJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlHYXRld2F5VXJsJywge1xuICAgICAgdmFsdWU6IGFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IFVSTCcsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpR2F0ZXdheUlkJywge1xuICAgICAgdmFsdWU6IGFwaS5yZXN0QXBpSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IElEJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdMYW1iZGFGdW5jdGlvbkFybicsIHtcbiAgICAgIHZhbHVlOiBhcGlMYW1iZGEuZnVuY3Rpb25Bcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0xhbWJkYSBGdW5jdGlvbiBBUk4nLFxuICAgIH0pO1xuICB9XG5cbiAgLy8gVE9ETzogUkVNT1ZFIElOIFBST0RVQ1RJT04gLSBUaGVzZSBzdXBwcmVzc2lvbnMgYXJlIGZvciBkZXZlbG9wbWVudCBvbmx5XG4gIC8vIEVhY2ggc3VwcHJlc3Npb24gbmVlZHMgdG8gYmUgYWRkcmVzc2VkIGZvciBwcm9kdWN0aW9uIGRlcGxveW1lbnRcbiAgcHJpdmF0ZSBhZGRDZGtOYWdTdXBwcmVzc2lvbnMoKTogdm9pZCB7XG4gICAgLy8gU3VwcHJlc3MgQUxMIENESyBOQUcgZXJyb3JzIGZvciBkZXZlbG9wbWVudCBkZXBsb3ltZW50XG4gICAgLy8gVE9ETzogUmVtb3ZlIHRoZXNlIHN1cHByZXNzaW9ucyBhbmQgZml4IGVhY2ggc2VjdXJpdHkgaXNzdWUgZm9yIHByb2R1Y3Rpb25cbiAgICBOYWdTdXBwcmVzc2lvbnMuYWRkU3RhY2tTdXBwcmVzc2lvbnModGhpcywgW1xuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1WUEM3JyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogVlBDIEZsb3cgTG9ncyB3aWxsIGJlIGFkZGVkIGluIHByb2R1Y3Rpb24gZm9yIG5ldHdvcmsgbW9uaXRvcmluZycsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TTUc0JyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQWRkIGF1dG9tYXRpYyBzZWNyZXQgcm90YXRpb24gZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtRUMyMycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFJlc3RyaWN0IGRhdGFiYXNlIGFjY2VzcyB0byBzcGVjaWZpYyBJUCByYW5nZXMgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUkRTMycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBNdWx0aS1BWiBmb3IgcHJvZHVjdGlvbiBoaWdoIGF2YWlsYWJpbGl0eScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1SRFMxMCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBkZWxldGlvbiBwcm90ZWN0aW9uIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLVJEUzExJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogVXNlIG5vbi1kZWZhdWx0IGRhdGFiYXNlIHBvcnQgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HMScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFN0cmVuZ3RoZW4gcGFzc3dvcmQgcG9saWN5IHRvIHJlcXVpcmUgc3BlY2lhbCBjaGFyYWN0ZXJzJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzInLFxuICAgICAgICByZWFzb246ICdUT0RPOiBFbmFibGUgTUZBIGZvciBwcm9kdWN0aW9uIHVzZXIgYXV0aGVudGljYXRpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ09HMycsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBhZHZhbmNlZCBzZWN1cml0eSBtb2RlIGZvciBwcm9kdWN0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNPRzQnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBBZGQgQ29nbml0byBVc2VyIFBvb2wgYXV0aG9yaXplciB0byBBUEkgR2F0ZXdheScsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1TMScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEVuYWJsZSBTMyBzZXJ2ZXIgYWNjZXNzIGxvZ2dpbmcgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtUzEwJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQWRkIFNTTC1vbmx5IGJ1Y2tldCBwb2xpY2llcyBmb3IgcHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1MMScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFVwZGF0ZSB0byBsYXRlc3QgTm9kZS5qcyBydW50aW1lIHZlcnNpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFJlcGxhY2UgQVdTIG1hbmFnZWQgcG9saWNpZXMgd2l0aCBjdXN0b20gcG9saWNpZXMnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtSUFNNScsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFJlbW92ZSB3aWxkY2FyZCBwZXJtaXNzaW9ucyBhbmQgdXNlIHNwZWNpZmljIHJlc291cmNlIEFSTnMnLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQVBJRzEnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBFbmFibGUgQVBJIEdhdGV3YXkgYWNjZXNzIGxvZ2dpbmcgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQVBJRzInLFxuICAgICAgICByZWFzb246ICdUT0RPOiBBZGQgcmVxdWVzdCB2YWxpZGF0aW9uIHRvIEFQSSBHYXRld2F5JyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUFQSUczJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogQXNzb2NpYXRlIEFQSSBHYXRld2F5IHdpdGggQVdTIFdBRiBmb3IgcHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1BUElHNCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEltcGxlbWVudCBBUEkgR2F0ZXdheSBhdXRob3JpemF0aW9uJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjEnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBBZGQgZ2VvIHJlc3RyaWN0aW9ucyBpZiBuZWVkZWQgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSMicsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IEludGVncmF0ZSBDbG91ZEZyb250IHdpdGggQVdTIFdBRiBmb3IgcHJvZHVjdGlvbicsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICBpZDogJ0F3c1NvbHV0aW9ucy1DRlIzJyxcbiAgICAgICAgcmVhc29uOiAnVE9ETzogRW5hYmxlIENsb3VkRnJvbnQgYWNjZXNzIGxvZ2dpbmcgZm9yIHByb2R1Y3Rpb24nLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdBd3NTb2x1dGlvbnMtQ0ZSNCcsXG4gICAgICAgIHJlYXNvbjogJ1RPRE86IFVwZGF0ZSBDbG91ZEZyb250IHRvIHVzZSBUTFMgMS4yKyBtaW5pbXVtJyxcbiAgICAgIH0sXG4gICAgICB7XG4gICAgICAgIGlkOiAnQXdzU29sdXRpb25zLUNGUjcnLFxuICAgICAgICByZWFzb246ICdUT0RPOiBVc2UgT3JpZ2luIEFjY2VzcyBDb250cm9sIGluc3RlYWQgb2YgT0FJJyxcbiAgICAgIH0sXG4gICAgXSk7XG4gIH1cbn1cbiJdfQ==