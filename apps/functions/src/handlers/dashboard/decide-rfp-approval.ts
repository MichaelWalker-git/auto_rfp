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
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

import { getOpportunity } from '@/helpers/opportunity';
import {
  transitionOpportunityApproval,
  InvalidApprovalTransitionError,
} from '@/helpers/opportunity-approval';
import { RfpApprovalDecisionSchema } from '@auto-rfp/core';
import type { OpportunityApprovalStatus, Permission } from '@auto-rfp/core';

/**
 * POST /dashboard/decide-rfp-approval
 *
 * A two-gate approval decision on the approval axis (never touches `status`):
 *   INITIAL + APPROVE → I_APPROVED    (gate 1 — requires rfp:approve_initial)
 *   INITIAL + REJECT  → NOT_APPROVED  (gate 1 — requires rfp:approve_initial)
 *   FINAL   + APPROVE → II_APPROVED   (gate 2 — requires rfp:approve_final)
 *   FINAL   + REJECT  → 400           (no reject at gate 2)
 *
 * The middy stack keeps opportunity:edit as a floor; the per-gate permission is
 * enforced in-handler because requirePermission is static.
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error } = RfpApprovalDecisionSchema.safeParse(body);
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

    const { projectId, oppId, gate, decision, reason } = data;

    // No rejection at gate 2 — proposal has already been reviewed.
    if (gate === 'FINAL' && decision === 'REJECT') {
      return apiResponse(400, {
        ok: false,
        error: 'Final approval cannot be rejected — only Initial Approval may be rejected',
      });
    }

    // Per-gate permission check (requirePermission is static, so gate the branch).
    const requiredPermission: Permission =
      gate === 'INITIAL' ? 'rfp:approve_initial' : 'rfp:approve_final';
    if (!event.rbac?.permissions.includes(requiredPermission)) {
      return apiResponse(403, {
        ok: false,
        error: `Missing permission: ${requiredPermission}`,
      });
    }

    const existing = await getOpportunity({ orgId, projectId, oppId });
    if (!existing) {
      return apiResponse(404, { ok: false, error: 'Opportunity not found' });
    }

    const fromApproval: OpportunityApprovalStatus =
      (existing.item.approvalStatus as OpportunityApprovalStatus | undefined) ?? 'INITIAL_APPROVAL';

    const toApproval: OpportunityApprovalStatus =
      gate === 'INITIAL'
        ? decision === 'APPROVE'
          ? 'I_APPROVED'
          : 'NOT_APPROVED'
        : 'II_APPROVED';

    const userId = getUserId(event);

    let item;
    try {
      item = await transitionOpportunityApproval({
        orgId,
        projectId,
        oppId,
        to: toApproval,
        changedBy: userId ?? 'system',
        gate,
        reason,
      });
    } catch (transitionErr: unknown) {
      if (transitionErr instanceof InvalidApprovalTransitionError) {
        return apiResponse(409, { ok: false, error: transitionErr.message });
      }
      throw transitionErr;
    }

    setAuditContext(event, {
      action: decision === 'APPROVE' ? 'OPPORTUNITY_APPROVED' : 'OPPORTUNITY_REJECTED',
      resource: 'opportunity',
      resourceId: oppId,
      orgId,
      changes: {
        before: { approvalStatus: fromApproval },
        after: { approvalStatus: toApproval },
      },
    });

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
    .use(auditMiddleware())
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit')),
);
