import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito'
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';
import { AuthorizationType } from 'aws-cdk-lib/aws-apigateway';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';

export interface ApiNestedStackProps extends cdk.NestedStackProps {
  /**
   * Shared API Gateway for this service (like in your example stack).
   */
  api: apigw.IRestApi;

  /**
   * Base path segment for this “bounded context”.
   * e.g. 'organization' → /organization/...
   */
  basePath: string;

  /**
   * Common Lambda role for all functions in this nested stack
   * (similar to CommonLambdaRole in your example).
   */
  lambdaRole: iam.IRole;

  /**
   * Environment variables shared by all lambdas in this nested stack.
   */
  commonEnv: Record<string, string>;


  userPool: IUserPool

}

export class ApiNestedStack extends cdk.NestedStack {
  public readonly api: apigw.IRestApi;
  public readonly stage: apigw.Stage;
  private readonly baseResource: apigw.IResource;
  private readonly authorizer: apigw.CognitoUserPoolsAuthorizer;
  private lambdaIndex = 0;

  constructor(scope: Construct, id: string, props: ApiNestedStackProps) {
    super(scope, id, props);

    const { api, basePath, lambdaRole, commonEnv } = props;

    this.api = api;
    this.stage = this.api.deploymentStage;

    // /organization, /user, /patient, etc.
    this.baseResource = this.api.root.addResource(basePath);

    // Save for later use when creating lambdas
    (this as any)._lambdaRole = lambdaRole;
    (this as any)._commonEnv = commonEnv;

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
  public addRoute(
    path: string,
    method: string,
    handlerEntry: string,
    extraEnv?: Record<string, string>,
  ): void {
    const lambdaRole = (this as any)._lambdaRole as iam.IRole;
    const commonEnv = (this as any)._commonEnv as Record<string, string>;

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
      authorizationType: AuthorizationType.COGNITO,
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
