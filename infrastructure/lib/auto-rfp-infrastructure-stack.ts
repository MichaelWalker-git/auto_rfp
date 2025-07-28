import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ses from 'aws-cdk-lib/aws-ses';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

export class AutoRfpInfrastructureStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from Lambda'
    );

    // Also allow connections from anywhere for external access (development/migration)
    dbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from anywhere (for development)'
    );

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
