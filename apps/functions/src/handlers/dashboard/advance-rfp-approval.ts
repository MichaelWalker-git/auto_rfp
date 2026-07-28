import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

import {
  transitionOpportunityApproval,
  InvalidApprovalTransitionError,
} from '@/helpers/opportunity-approval';
import { RfpApprovalAdvanceSchema } from '@auto-rfp/core';

/**
 * POST /dashboard/advance-rfp-approval
 *
 * Non-gate stage moves that don't require an approver — just opportunity:edit:
 *   I_APPROVED  → PRE_SUB_APPROVAL  "send for pre-sub review"
 *   II_APPROVED → SUBMITTED         "mark submitted"
 *
 * The allowed-transition map in the approval helper enforces the legal edges;
 * an illegal move (e.g. advancing to PRE_SUB_APPROVAL from the wrong stage) is
 * mapped to 409.
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error } = RfpApprovalAdvanceSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: error.issues,
      });
    }

    const orgId = data.orgId ?? getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { ok: false, error: 'orgId is required' });
    }

    const { projectId, oppId, to } = data;
    const userId = getUserId(event);

    let item;
    try {
      item = await transitionOpportunityApproval({
        orgId,
        projectId,
        oppId,
        to,
        changedBy: userId ?? 'system',
        gate: 'STAGE',
      });
    } catch (transitionErr: unknown) {
      if (transitionErr instanceof InvalidApprovalTransitionError) {
        return apiResponse(409, { ok: false, error: transitionErr.message });
      }
      if (transitionErr instanceof Error && transitionErr.message.startsWith('Opportunity not found')) {
        return apiResponse(404, { ok: false, error: 'Opportunity not found' });
      }
      throw transitionErr;
    }

    return apiResponse(200, { ok: true, oppId, item });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { ok: false, error: 'Opportunity not found' });
    }
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal Server Error',
    });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit')),
);
