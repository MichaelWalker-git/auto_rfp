import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { DomainRoutes } from './routes/types';

export interface ApiDomainRoutesStackProps extends cdk.NestedStackProps {
  api: apigateway.IRestApi;
  rootResourceId: string;
  userPoolId: string;
  lambdaRole: iam.IRole;
  commonEnv: Record<string, string>;
  domain: DomainRoutes;
  authorizer?: apigateway.IAuthorizer;
}

// CORS configuration for preflight requests
const CORS_OPTIONS = {
  allowOrigins: apigateway.Cors.ALL_ORIGINS,
  allowMethods: apigateway.Cors.ALL_METHODS,
  allowHeaders: [
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Amz-Security-Token',
  ],
  allowCredentials: true,
};

/**
 * Creates Lambda functions and API Gateway routes for a specific domain
 * This is a NestedStack to manage CloudFormation resource limits
 * 
 * CORS preflight OPTIONS methods are added to all resources since
 * defaultCorsPreflightOptions doesn't work with resources created via fromResourceAttributes()
 */
export class ApiDomainRoutesStack extends cdk.NestedStack {
  // Track resources that already have CORS configured to avoid duplicates
  private corsConfiguredResources = new Set<string>();

  constructor(scope: Construct, id: string, props: ApiDomainRoutesStackProps) {
    super(scope, id, props);

    const { api, rootResourceId, userPoolId, lambdaRole, commonEnv, domain, authorizer } = props;

    // Get the root resource from the API
    const rootResource = apigateway.Resource.fromResourceAttributes(this, 'RootResource', {
      restApi: api,
      resourceId: rootResourceId,
      path: '/',
    });

    // Create domain base resource
    let domainResource: apigateway.IResource = rootResource;
    for (const pathSegment of domain.basePath.split('/').filter(s => s)) {
      // Try to get existing resource or create new one
      const existingResource = domainResource.getResource(pathSegment);
      if (existingResource) {
        domainResource = existingResource;
      } else {
        const newResource = (domainResource as apigateway.Resource).addResource(pathSegment);
        // Add CORS preflight to the new resource
        this.addCorsPreflight(newResource);
        domainResource = newResource;
      }
    }

    // Create Lambda function and routes for each endpoint in the domain
    for (const route of domain.routes) {
      // Create a unique construct ID for this route.
      // Include the HTTP method so that two routes with the same path but
      // different methods (e.g. PUT /override and DELETE /override) don't
      // collide on the same CloudFormation logical ID / log group name.
      const functionId = `${route.method.toLowerCase()}-${domain.basePath}-${route.path}-handler`;
      
      // Create log group with retention policy
      const logGroup = new logs.LogGroup(this, `${functionId}-logs`, {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // Create Lambda function for this route
      const lambdaFunction = new nodejs.NodejsFunction(this, functionId, {
        runtime: lambda.Runtime.NODEJS_24_X,
        entry: route.entry,
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
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
          minify: true,
          sourceMap: false,
          target: 'es2022',
          format: nodejs.OutputFormat.CJS,
          mainFields: ['module', 'main'],
        },
      });

      // Navigate/create nested resource path for the route
      let resourcePath: apigateway.IResource = domainResource;
      const pathSegments = route.path.split('/').filter(s => s);

      for (const segment of pathSegments) {
        const existingResource = resourcePath.getResource(segment);
        if (existingResource) {
          resourcePath = existingResource;
        } else {
          const newResource = (resourcePath as apigateway.Resource).addResource(segment);
          // Add CORS preflight to the new resource
          this.addCorsPreflight(newResource);
          resourcePath = newResource;
        }
      }

      // Create API Gateway method and integration
      const integration = new apigateway.LambdaIntegration(lambdaFunction);

      // Add method with Cognito authorization if authorizer is provided
      // OPTIONS methods should never require authorization for CORS preflight
      // Routes with auth: 'NONE' skip authorization (for public endpoints like calendar subscription)
      const methodOptions: apigateway.MethodOptions =
        route.method === 'OPTIONS' || route.auth === 'NONE'
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

      (resourcePath as apigateway.Resource).addMethod(route.method, integration, methodOptions);
    }
  }

  /**
   * Add CORS preflight OPTIONS method to a resource if not already configured
   */
  private addCorsPreflight(resource: apigateway.Resource): void {
    const resourcePath = resource.path;
    
    // Skip if already configured
    if (this.corsConfiguredResources.has(resourcePath)) {
      return;
    }
    
    this.corsConfiguredResources.add(resourcePath);
    
    // Add CORS preflight using the built-in method
    resource.addCorsPreflight(CORS_OPTIONS);
  }
}