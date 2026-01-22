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

export function getOrgId(event: APIGatewayProxyEventV2): string | undefined {
  const rc = event.requestContext as RequestContextWithAuthorizer;

  const claims =
    rc.authorizer?.jwt?.claims ??
    rc.authorizer?.claims;

  const orgIdFromToken = claims?.['custom:orgId'];
  if (!orgIdFromToken) {
    const { orgId: orgIdFromQueryString } = event.queryStringParameters || {};
    return orgIdFromQueryString;
  }

  return orgIdFromToken;
}
