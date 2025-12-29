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

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

type RequestContextWithAuthorizer = APIGatewayProxyEventV2['requestContext'] & {
  authorizer?: {
    jwt?: { claims?: Record<string, any> };
    claims?: Record<string, any>;
  };
};

export function getOrgId(event: APIGatewayProxyEventV2): string | null {
  const rc = event.requestContext as RequestContextWithAuthorizer;

  const claims =
    rc.authorizer?.jwt?.claims ??
    rc.authorizer?.claims;

  const orgId = claims?.['custom:orgId'];

  return typeof orgId === 'string' && orgId.trim() ? orgId : null;
}
