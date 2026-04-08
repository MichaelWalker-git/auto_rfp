import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as fs from 'fs';
import * as path from 'path';
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
    'X-Org-Id',
  ],
  allowCredentials: true,
};

const HANDLERS_DIR = path.resolve(__dirname, '../../../apps/functions/src/handlers');

/**
 * Generate a router entry file for a domain that statically imports all handlers
 * and creates a router dispatch table.
 */
const generateRouterEntry = (domain: DomainRoutes): string => {
  const imports: string[] = [];
  const routeEntries: string[] = [];

  for (let i = 0; i < domain.routes.length; i++) {
    const route = domain.routes[i]!;
    const alias = `h${i}`;

    // Convert absolute entry path to relative import from the _routers dir
    const handlerRelativePath = path.relative(
      path.join(HANDLERS_DIR, '_routers'),
      route.entry,
    ).replace(/\.ts$/, '');

    imports.push(`import { handler as ${alias} } from '${handlerRelativePath}';`);
    routeEntries.push(`  { method: '${route.method}', path: '${route.path}', handler: ${alias} },`);
  }

  return `// Auto-generated domain router for '${domain.basePath}'
// DO NOT EDIT — regenerated during CDK synth
import { createRouter } from '../../router';
${imports.join('\n')}

export const handler = createRouter([
${routeEntries.join('\n')}
]);
`;
};

/**
 * Creates a single Lambda function + proxy route for an entire domain.
 *
 * Instead of one Lambda per endpoint, all routes in a domain are served by
 * a single Lambda with an internal router. API Gateway uses {proxy+} to
 * forward all requests under the domain base path.
 *
 * This reduces API Gateway resources from ~5 per route to ~2 per domain,
 * avoiding the 300 resource limit.
 */
export class ApiDomainRoutesStack extends cdk.NestedStack {
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
      const existingResource = domainResource.getResource(pathSegment);
      if (existingResource) {
        domainResource = existingResource;
      } else {
        domainResource = (domainResource as apigateway.Resource).addResource(pathSegment);
      }
    }

    // Generate router entry file
    const routerCode = generateRouterEntry(domain);
    const routerDir = path.join(HANDLERS_DIR, '_routers');
    if (!fs.existsSync(routerDir)) fs.mkdirSync(routerDir, { recursive: true });

    const routerFileName = `${domain.basePath.replace(/\//g, '-')}-router.ts`;
    const routerFilePath = path.join(routerDir, routerFileName);
    fs.writeFileSync(routerFilePath, routerCode);

    // Compute max timeout and memory across all routes
    const maxTimeout = domain.routes.reduce((max, r) => Math.max(max, r.timeoutSeconds ?? 30), 30);
    const maxMemory = domain.routes.reduce((max, r) => Math.max(max, r.memorySize ?? 512), 512);

    // Collect all nodeModules needed by any route in the domain
    const allNodeModules = new Set<string>();
    for (const route of domain.routes) {
      if (route.nodeModules) {
        for (const mod of route.nodeModules) allNodeModules.add(mod);
      }
    }

    // Collect all extra env vars
    const allExtraEnv: Record<string, string> = {};
    for (const route of domain.routes) {
      if (route.extraEnv) Object.assign(allExtraEnv, route.extraEnv);
    }

    const functionId = `${domain.basePath.replace(/\//g, '-')}-router`;

    // Create log group
    const logGroup = new logs.LogGroup(this, `${functionId}-logs`, {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create single Lambda for the entire domain
    const lambdaFunction = new nodejs.NodejsFunction(this, functionId, {
      runtime: lambda.Runtime.NODEJS_24_X,
      entry: routerFilePath,
      handler: 'handler',
      timeout: cdk.Duration.seconds(maxTimeout),
      memorySize: maxMemory,
      role: lambdaRole,
      environment: {
        ...commonEnv,
        ...allExtraEnv,
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
        ...(allNodeModules.size > 0 ? { nodeModules: [...allNodeModules] } : {}),
        minify: true,
        sourceMap: false,
        target: 'es2022',
        format: nodejs.OutputFormat.CJS,
        mainFields: ['module', 'main'],
      },
    });

    const integration = new apigateway.LambdaIntegration(lambdaFunction);

    const methodOptions: apigateway.MethodOptions = authorizer
      ? { authorizationType: apigateway.AuthorizationType.COGNITO, authorizer }
      : { authorizationType: apigateway.AuthorizationType.NONE };

    // Add {proxy+} resource under the domain base path
    (domainResource as apigateway.Resource).addProxy({
      defaultIntegration: integration,
      defaultMethodOptions: methodOptions,
      anyMethod: true,
      defaultCorsPreflightOptions: CORS_OPTIONS,
    });

    // Also add method on the base path itself (for routes with empty path)
    (domainResource as apigateway.Resource).addMethod('ANY', integration, methodOptions);
    (domainResource as apigateway.Resource).addCorsPreflight(CORS_OPTIONS);
  }
}
