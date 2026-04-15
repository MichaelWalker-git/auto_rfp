import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as apigwv2Authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { DomainRoutes } from './routes/types';

const HTTP_METHODS: Record<string, apigwv2.HttpMethod> = {
  GET: apigwv2.HttpMethod.GET,
  POST: apigwv2.HttpMethod.POST,
  PUT: apigwv2.HttpMethod.PUT,
  PATCH: apigwv2.HttpMethod.PATCH,
  DELETE: apigwv2.HttpMethod.DELETE,
  OPTIONS: apigwv2.HttpMethod.OPTIONS,
  ANY: apigwv2.HttpMethod.ANY,
};

export interface ApiDomainLambdaStackProps extends cdk.NestedStackProps {
  httpApi: apigwv2.IHttpApi;
  userPoolId: string;
  lambdaRole: iam.IRole;
  commonEnv: Record<string, string>;
  domain: DomainRoutes;
  authorizer: apigwv2Authorizers.HttpJwtAuthorizer;
}

/**
 * Creates Lambda functions + log groups + HttpApi routes for a domain.
 * All resources stay in the nested stack to respect CloudFormation limits.
 */
export class ApiDomainLambdaStack extends cdk.NestedStack {
  constructor(scope: Construct, id: string, props: ApiDomainLambdaStackProps) {
    super(scope, id, props);

    const { httpApi, userPoolId, lambdaRole, commonEnv, domain, authorizer } = props;

    for (const route of domain.routes) {
      const functionId = `${route.method.toLowerCase()}-${domain.basePath}-${route.path}-handler`
        .replace(/[^a-zA-Z0-9-]/g, '-')
        .replace(/-+/g, '-');

      const logGroup = new logs.LogGroup(this, `${functionId}-logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const lambdaFunction = new nodejs.NodejsFunction(this, functionId, {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: route.entry,
        handler: 'handler',
        timeout: cdk.Duration.seconds(route.timeoutSeconds ?? 30),
        memorySize: route.memorySize ?? 512,
        role: lambdaRole,
        environment: {
          ...commonEnv,
          ...route.extraEnv,
          COGNITO_USER_POOL_ID: userPoolId,
        },
        logGroup,
        bundling: {
          externalModules: [
            '@aws-sdk/*',
            '@smithy/*',
            '@aws-crypto/*',
            '@aws-sdk/client-s3',
            '@aws-sdk/client-secrets-manager',
            '@aws-sdk/s3-request-presigner',
            '@aws-sdk/client-rds-data',
          ],
          ...(route.nodeModules?.length ? { nodeModules: route.nodeModules } : {}),
          minify: true,
          sourceMap: false,
          target: 'es2022',
          format: nodejs.OutputFormat.CJS,
          mainFields: ['module', 'main'],
        },
      });

      // Register route on the HttpApi
      const integration = new apigwv2Integrations.HttpLambdaIntegration(
        `${functionId}-int`,
        lambdaFunction,
      );

      const routePath = `/${domain.basePath}/${route.path}`.replace(/\/+/g, '/');
      const httpMethod = HTTP_METHODS[route.method] ?? apigwv2.HttpMethod.ANY;

      new apigwv2.HttpRoute(this, `${functionId}-route`, {
        httpApi: apigwv2.HttpApi.fromHttpApiAttributes(this, `${functionId}-api`, {
          httpApiId: httpApi.apiId,
        }),
        routeKey: apigwv2.HttpRouteKey.with(routePath, httpMethod),
        integration,
        authorizer: route.auth === 'NONE' ? new apigwv2.HttpNoneAuthorizer() : authorizer,
      });
    }
  }
}
