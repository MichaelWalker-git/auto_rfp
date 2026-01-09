import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '../sentry-lambda';
import { apiResponse, getOrgId } from '../helpers/api';
import { OpportunityQuerySchema } from '@auto-rfp/shared';


import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

import { listOpportunitiesByProject } from '../helpers/opportunity';

const safeJsonParse = <T, >(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

// TODO Kate
const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(401, { ok: false, error: 'Unauthorized' });
    }

    const q = event.queryStringParameters ?? {};
    const { success, data, error } = OpportunityQuerySchema.safeParse(q);

    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Invalid query parameters',
        details: error.flatten(),
      });
    }

    const { projectId, limit, nextToken } = data;

    const decodedNextToken = nextToken ? decodeURIComponent(nextToken) : undefined;
    const exclusiveStartKey = decodedNextToken
      ? safeJsonParse<Record<string, any>>(decodedNextToken)
      : undefined;

    if (decodedNextToken && !exclusiveStartKey) {
      return apiResponse(400, {
        ok: false,
        error: 'Invalid nextToken (must be JSON-encoded LastEvaluatedKey)',
      });
    }

    const res = await listOpportunitiesByProject({
      orgId,
      projectId,
      limit,
      nextToken: exclusiveStartKey,
    });

    return apiResponse(200, {
      ok: true,
      items: res.items,
      nextToken: res.nextToken ? JSON.stringify(res.nextToken) : null,
    });
  } catch (err: any) {
    return apiResponse(500, {
      ok: false,
      error: err?.message ?? 'Internal Server Error',
    });
  }
};

export const handler = withSentryLambda(
  middy<APIGatewayProxyEventV2, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);