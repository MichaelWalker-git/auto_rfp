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
import { RFP_SYNC_PROJECT_ID } from '@auto-rfp/core';

/**
 * GET /dashboard/get-rfp-pipeline
 *
 * Returns the Linear-synced RFP-tracking records for the org — scoped to the
 * sync project (RFP_SYNC_PROJECT_ID) so the board mirrors the Linear
 * "Government Contracting" board rather than every org opportunity (SAM.gov /
 * HigherGov / manual imports live under other projects and would otherwise
 * flood the intake column). The board, approval queue, and needs-attention
 * flags are all derived client-side from this single fetch. Items carry
 * statusHistory + dollar value + outcome detail on top of the list-card fields
 * (see RfpPipelineItemSchema in @auto-rfp/core). An explicit `projectId` query
 * param overrides the default scope.
 */
export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { ok: false, error: 'orgId is required' });
    }

    const projectId = event.queryStringParameters?.projectId ?? RFP_SYNC_PROJECT_ID;
    const { items } = await listOpportunitiesByOrg({ orgId, projectId });

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
