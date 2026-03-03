import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { listEngagementLogsByOpportunity } from '@/helpers/engagement-log';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const QuerySchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  nextToken: z.string().optional(),
});

const safeJsonParse = <T,>(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(401, { ok: false, error: 'Unauthorized' });
  }

  const q = event.queryStringParameters ?? {};
  const { success, data, error: errors } = QuerySchema.safeParse(q);

  if (!success) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid query parameters',
      details: errors.flatten(),
    });
  }

  const { projectId, opportunityId, limit, nextToken } = data;

  const decodedNextToken = nextToken ? decodeURIComponent(nextToken) : undefined;
  const exclusiveStartKey = decodedNextToken
    ? safeJsonParse<Record<string, unknown>>(decodedNextToken)
    : undefined;

  if (decodedNextToken && !exclusiveStartKey) {
    return apiResponse(400, {
      ok: false,
      error: 'Invalid nextToken (must be JSON-encoded LastEvaluatedKey)',
    });
  }

  const res = await listEngagementLogsByOpportunity({
    orgId,
    projectId,
    opportunityId,
    limit,
    nextToken: exclusiveStartKey,
  });

  return apiResponse(200, {
    ok: true,
    items: res.items,
    count: res.items.length,
    nextToken: res.nextToken ? JSON.stringify(res.nextToken) : null,
  });
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
