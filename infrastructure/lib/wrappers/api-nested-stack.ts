import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { AuthorizationType } from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { IUserPool } from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

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

  userPool: IUserPool,

  authorizer: apigw.CognitoUserPoolsAuthorizer;
}

export class ApiNestedStack extends cdk.NestedStack {
  public readonly api: apigw.IRestApi;
  public readonly stage: apigw.Stage;
  private readonly baseResource: apigw.IResource;
  private readonly authorizer: apigw.CognitoUserPoolsAuthorizer;
  private lambdaIndex = 0;

  constructor(scope: Construct, id: string, props: ApiNestedStackProps) {
    super(scope, id, props);

    const { api, basePath, lambdaRole, commonEnv, authorizer } = props;

    this.api = api;
    this.stage = this.api.deploymentStage;

    this.baseResource = this.api.root.addResource(basePath);
    this.authorizer = authorizer;

    (this as any)._lambdaRole = lambdaRole;
    (this as any)._commonEnv = commonEnv;
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
}
