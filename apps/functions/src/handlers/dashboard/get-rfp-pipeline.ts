import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { listOpportunitiesByOrg } from '@/helpers/opportunity';

/**
 * GET /dashboard/get-rfp-pipeline
 *
 * Returns every opportunity in the org so the RFP-tracking board, approval
 * queue, and needs-attention flags can be derived client-side from a single
 * fetch. Items carry statusHistory + dollar value + outcome detail on top of
 * the list-card fields (see RfpPipelineItemSchema in @auto-rfp/core).
 */
export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { ok: false, error: 'orgId is required' });
    }

    const { items } = await listOpportunitiesByOrg({ orgId });

    return apiResponse(200, { ok: true, items });
  } catch (err: unknown) {
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal Server Error',
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
