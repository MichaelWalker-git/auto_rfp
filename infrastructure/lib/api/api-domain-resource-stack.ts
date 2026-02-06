import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import type { DomainRoutes } from './routes/types';

export interface ApiDomainRoutesStackProps extends cdk.StackProps {
  restApiId: string;
  rootResourceId: string;
  userPoolId: string;
  lambdaRoleArn: string;
  commonEnv: Record<string, string>;
  domain: DomainRoutes;
  authorizer?: apigateway.CognitoUserPoolsAuthorizer;
  deployment: apigateway.Deployment;
}

/**
 * Creates Lambda functions and API Gateway routes for a specific domain
 * Each domain gets its own stack to manage CloudFormation resource limits
 */
export class ApiDomainRoutesStack extends cdk.Stack {
  private optionsMethodsAdded = new Set<string>();

  constructor(scope: Construct, id: string, props: ApiDomainRoutesStackProps) {
    super(scope, id, props);

    const { restApiId, rootResourceId, userPoolId, lambdaRoleArn, commonEnv, domain, authorizer } = props;

    // Get references to existing API Gateway resources
    const api = apigateway.RestApi.fromRestApiAttributes(this, 'Api', {
      restApiId,
      rootResourceId,
    });

    // Get reference to existing Lambda role
    const lambdaRole = iam.Role.fromRoleArn(this, 'CommonLambdaRole', lambdaRoleArn, {
      mutable: false,
    });

    // Create domain base resource
    let domainResource = api.root;
    for (const pathSegment of domain.basePath.split('/')) {
      domainResource = domainResource.getResource(pathSegment) || domainResource.addResource(pathSegment);
    }

    // Add OPTIONS method to the domain base resource for CORS
    const domainResourceId = domainResource.path;
    if (!this.optionsMethodsAdded.has(domainResourceId)) {
      this.optionsMethodsAdded.add(domainResourceId);
      domainResource.addMethod('OPTIONS', new apigateway.MockIntegration({
        integrationResponses: [{
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': '\'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token\'',
            'method.response.header.Access-Control-Allow-Origin': '\'*\'',
            'method.response.header.Access-Control-Allow-Methods': '\'GET,POST,PUT,PATCH,DELETE,OPTIONS\'',
            'method.response.header.Access-Control-Allow-Credentials': '\'true\'',
          },
        }],
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        requestTemplates: {
          'application/json': '{"statusCode": 200}',
        },
      }), {
        authorizationType: apigateway.AuthorizationType.NONE,
        methodResponses: [{
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        }],
      });
    }

    // Create Lambda function and routes for each endpoint in the domain
    for (const route of domain.routes) {
      // Create Lambda function for this route
      const lambdaFunction = new nodejs.NodejsFunction(this, `${domain.basePath}-${route.path}-handler`, {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: route.entry,
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        role: lambdaRole,
        environment: {
          ...commonEnv,
          COGNITO_USER_POOL_ID: userPoolId,
        },
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
          minify: true,
          sourceMap: false,
          target: 'es2022',
          format: nodejs.OutputFormat.CJS,
          mainFields: ['module', 'main'],
        },
      });

      // Navigate/create nested resource path for the route
      let resourcePath = domainResource;
      const pathSegments = route.path.split('/').filter(s => s);

      for (const segment of pathSegments) {
        if (segment.startsWith('{') && segment.endsWith('}')) {
          resourcePath = resourcePath.getResource(segment) || resourcePath.addResource(segment);
        } else {
          resourcePath = resourcePath.getResource(segment) || resourcePath.addResource(segment);
        }

        // Add OPTIONS method to each intermediate resource for CORS
        const intermediateResourceId = resourcePath.path;
        if (!this.optionsMethodsAdded.has(intermediateResourceId)) {
          this.optionsMethodsAdded.add(intermediateResourceId);
          resourcePath.addMethod('OPTIONS', new apigateway.MockIntegration({
            integrationResponses: [{
              statusCode: '200',
              responseParameters: {
                'method.response.header.Access-Control-Allow-Headers': '\'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token\'',
                'method.response.header.Access-Control-Allow-Origin': '\'*\'',
                'method.response.header.Access-Control-Allow-Methods': '\'GET,POST,PUT,PATCH,DELETE,OPTIONS\'',
                'method.response.header.Access-Control-Allow-Credentials': '\'true\'',
              },
            }],
            passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
            requestTemplates: {
              'application/json': '{"statusCode": 200}',
            },
          }), {
            authorizationType: apigateway.AuthorizationType.NONE,
            methodResponses: [{
              statusCode: '200',
              responseParameters: {
                'method.response.header.Access-Control-Allow-Headers': true,
                'method.response.header.Access-Control-Allow-Origin': true,
                'method.response.header.Access-Control-Allow-Methods': true,
                'method.response.header.Access-Control-Allow-Credentials': true,
              },
            }],
          });
        }
      }

      // Create API Gateway method and integration
      // Using proxy: true since Lambda functions return API Gateway Proxy format responses
      const integration = new apigateway.LambdaIntegration(lambdaFunction);

      // Add method with Cognito authorization if authorizer is provided
      // OPTIONS methods should never require authorization for CORS preflight
      const methodOptions: apigateway.MethodOptions =
        route.method === 'OPTIONS'
          ? {
            authorizationType: apigateway.AuthorizationType.NONE,
          }
          : authorizer
            ? {
              authorizationType: apigateway.AuthorizationType.COGNITO,
              authorizer: authorizer,
            }
            : {
              authorizationType: apigateway.AuthorizationType.NONE,
            };

      resourcePath.addMethod(route.method, integration, methodOptions);
    }
  }
}