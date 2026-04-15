/**
 * Generic domain router for API Gateway proxy integration.
 *
 * Each domain Lambda receives ALL requests for its base path via {proxy+}.
 * This router matches METHOD + path pattern to the correct handler and
 * forwards the event.
 *
 * Usage (generated entry files import this):
 *   import { createRouter } from '@/router';
 *   import { handler as getTemplates } from '@/handlers/templates/get-templates';
 *   ...
 *   export const handler = createRouter([
 *     { method: 'GET', path: 'list', handler: getTemplates },
 *     { method: 'POST', path: 'create', handler: createTemplate },
 *   ]);
 */
/**
 * Supports both REST API v1 (APIGatewayProxyEvent) and HTTP API v2 (APIGatewayProxyEventV2).
 * We use `any` for the event type since both API versions are supported.
 */
type Handler = (event: Record<string, unknown>) => Promise<Record<string, unknown>>;

interface Route {
  method: string;
  /** Path pattern relative to domain base, e.g. 'list', 'get/{id}', 'restore/{id}/{version}' */
  path: string;
  handler: Handler;
}

/**
 * Match a route definition pattern like 'get/{id}' against an actual path like 'get/abc-123'.
 * Extracts path parameters into a Record.
 */
const matchPath = (
  pattern: string,
  actual: string,
): { match: boolean; params: Record<string, string> } => {
  const patternParts = pattern.split('/').filter(Boolean);
  const actualParts = actual.split('/').filter(Boolean);

  if (patternParts.length !== actualParts.length) {
    return { match: false, params: {} };
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i]!;
    const ap = actualParts[i]!;

    if (pp.startsWith('{') && pp.endsWith('}')) {
      // Path parameter — extract value
      const paramName = pp.slice(1, -1);
      params[paramName] = decodeURIComponent(ap);
    } else if (pp !== ap) {
      return { match: false, params: {} };
    }
  }

  return { match: true, params };
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Org-Id',
  'Access-Control-Allow-Credentials': 'true',
};

export const createRouter = (routes: Route[]) => {
  return async (event: Record<string, unknown>) => {
    // Support both REST API v1 and HTTP API v2
    const rc = event.requestContext as Record<string, unknown> | undefined;
    const http = rc?.http as Record<string, unknown> | undefined;
    const method = (http?.method ?? event.httpMethod ?? '') as string;

    // Handle CORS preflight
    if (method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: '',
      };
    }

    // Extract the sub-path after the domain base path
    // API Gateway proxy+ puts the matched portion in pathParameters.proxy
    const pathParams = (event.pathParameters ?? {}) as Record<string, string>;
    const proxyPath = (pathParams.proxy ?? '').replace(/^\//, '');

    // Find matching route
    for (const route of routes) {
      if (route.method !== method) continue;

      const { match, params } = matchPath(route.path, proxyPath);
      if (!match) continue;

      // Merge extracted path params into the event
      event.pathParameters = {
        ...pathParams,
        ...params,
      };

      return route.handler(event);
    }

    // No route matched
    console.warn(`[router] No route matched: ${method} /${proxyPath}`);
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ message: `No route matched: ${method} /${proxyPath}` }),
    };
  };
};
