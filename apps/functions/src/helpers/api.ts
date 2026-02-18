import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { APIGatewayProxyResultV2, } from 'aws-lambda';

export function apiResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

type RequestContextWithAuthorizer = APIGatewayProxyEventV2['requestContext'] & {
  authorizer?: {
    jwt?: { claims?: Record<string, any> };
    claims?: Record<string, any>;
  };
};

export function getUserId(event: APIGatewayProxyEventV2): string | undefined {
  // First try the auth context set by RBAC middleware
  const auth = (event as any).auth;
  if (auth?.userId) return auth.userId;

  // Fallback: extract from JWT claims
  const rc = event.requestContext as RequestContextWithAuthorizer;
  const claims = rc.authorizer?.jwt?.claims ?? rc.authorizer?.claims;
  return claims?.sub as string | undefined;
}

export function getOrgId(event: APIGatewayProxyEventV2): string | undefined {
  // 1. Prefer the auth context set by RBAC middleware (resolves header → query)
  const auth = (event as any).auth;
  if (auth?.orgId) return auth.orgId;

  // 2. X-Org-Id header (multi-org support)
  const orgIdFromHeader = event.headers?.['x-org-id'];
  if (orgIdFromHeader) return orgIdFromHeader;

  // 3. Query string parameter
  const orgIdFromQuery = event.queryStringParameters?.orgId;
  if (orgIdFromQuery) return orgIdFromQuery;

  // 4. Request body (some endpoints send orgId in the body)
  if (event.body) {
    try {
      const body = JSON.parse(event.body);
      if (body?.orgId) return body.orgId;
    } catch {
      // Not JSON or no orgId — continue
    }
  }

  return undefined;
}
