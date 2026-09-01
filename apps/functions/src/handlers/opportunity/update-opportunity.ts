import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

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

import { updateOpportunity, getOpportunity } from '@/helpers/opportunity';
import { transitionOpportunityStatus } from '@/helpers/opportunity-status';
import { syncPhysicalSubmissionLabel } from '@/helpers/linear';
import { OpportunityUpdateRequestSchema, TERMINAL_OPPORTUNITY_STATUSES, isPhysicalSubmission } from '@auto-rfp/core';
import type { OpportunityStatus } from '@auto-rfp/core';
import { resolveUserNames } from '@/helpers/resolve-users';
import { getOrgMembers } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';

// Schema for update request - all fields optional except identifiers
const UpdateOpportunityRequestSchema = z.object({
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  patch: OpportunityUpdateRequestSchema,
});

/**
 * Update an existing opportunity
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    console.log('Update Opportunity Event:', JSON.stringify(event, null, 2));

    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, {
        ok: false,
        error: 'Missing orgId',
      });
    }

    const body = JSON.parse(event.body || '{}');
    const { success, data, error } = UpdateOpportunityRequestSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: error.errors,
      });
    }
    const { projectId, oppId, patch } = data;

    // Verify opportunity exists
    const existing = await getOpportunity({ orgId, projectId, oppId });
    if (!existing) {
      return apiResponse(404, {
        ok: false,
        error: 'Opportunity not found',
      });
    }

    // Cross-field validation for a terminal outcome (the partial patch schema can't
    // carry the old superRefine): WON needs winData, LOST needs lossData, and a
    // STATE jurisdiction needs a state.
    const nextStatus = patch.status as OpportunityStatus | undefined;
    if (nextStatus === 'WON' && !patch.winData && !existing.item.winData) {
      return apiResponse(400, { ok: false, error: 'winData is required when status is WON' });
    }
    if (nextStatus === 'LOST' && !patch.lossData && !existing.item.lossData) {
      return apiResponse(400, { ok: false, error: 'lossData is required when status is LOST' });
    }
    const effectiveJurisdiction = patch.jurisdiction ?? existing.item.jurisdiction;
    const effectiveState = patch.state ?? existing.item.state;
    if (effectiveJurisdiction === 'STATE' && !effectiveState) {
      return apiResponse(400, { ok: false, error: 'state is required when jurisdiction is STATE' });
    }

    const userId = getUserId(event);

    // Resolve the caller's display name from the user table
    let userName: string | undefined;
    if (userId && orgId) {
      const nameMap = await resolveUserNames(orgId, [userId]);
      userName = nameMap[userId];
    }

    const prevStatus = (existing.item.status as OpportunityStatus | undefined) ?? 'IDENTIFIED';
    const statusChanged = nextStatus !== undefined && nextStatus !== prevStatus;

    let item;
    if (statusChanged) {
      // Status change → go through the transition helper (records statusHistory,
      // persists outcome detail, stamps outcomeDate/outcomeSetBy, syncs APN), then
      // apply any remaining non-status fields.
      const { status: _status, winData, lossData, jurisdiction, state, outcomeComment, ...rest } = patch;
      item = await transitionOpportunityStatus({
        orgId,
        projectId,
        oppId,
        toStatus: nextStatus,
        changedBy: userId ?? 'system',
        reason: outcomeComment ?? undefined,
        source: 'MANUAL',
        outcome: { winData, lossData, jurisdiction, state, outcomeComment },
      });
      if (Object.keys(rest).length > 0) {
        ({ item } = await updateOpportunity({ orgId, projectId, oppId, patch: rest, userContext: { userId, userName } }));
      }

      // Notify org members when transitioning into a terminal WON/LOST outcome.
      if ((nextStatus === 'WON' || nextStatus === 'LOST') && TERMINAL_OPPORTUNITY_STATUSES.includes(nextStatus)) {
        const notifType = nextStatus === 'WON' ? 'WIN_RECORDED' : 'LOSS_RECORDED';
        const title = nextStatus === 'WON' ? '🎉 Proposal Won!' : 'Proposal Result Recorded';
        const message = nextStatus === 'WON'
          ? `Your team won "${item.title ?? oppId}".`
          : `The proposal for "${item.title ?? oppId}" was not selected.`;
        const outcomeLink = `/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}`;

        getOrgMembers(orgId)
          .then((members) => {
            if (members.length === 0) return;
            return sendNotification(
              buildNotification(notifType, title, message, {
                orgId,
                projectId,
                entityId: oppId,
                recipientUserIds: members.map((m) => m.userId),
                recipientEmails: members.map((m) => m.email),
                link: outcomeLink,
              }),
            );
          })
          .catch((err) => console.error('Failed to send outcome notification:', err));
      }
    } else {
      // No status change → plain field update.
      ({ item } = await updateOpportunity({ orgId, projectId, oppId, patch, userContext: { userId, userName } }));
    }

    // Keep the Linear label in sync when the user manually toggles submission
    // method. Fire-and-forget: a Linear API failure must never fail the PATCH,
    // since the opportunity update above is already committed.
    if ('submissionMethod' in patch) {
      syncPhysicalSubmissionLabel(orgId, oppId, isPhysicalSubmission(patch.submissionMethod)).catch((syncErr) =>
        console.warn('Failed to sync physical-submission Linear label:', (syncErr as Error)?.message),
      );
    }

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: event.pathParameters?.opportunityId ?? event.queryStringParameters?.opportunityId ?? 'unknown',
    });

    return apiResponse(200, {
      ok: true,
      oppId,
      item,
    });
  } catch (err: unknown) {
    console.error('Update opportunity error:', err);

    if (err instanceof Error && err.name === 'ZodError') {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: (err as z.ZodError).errors,
      });
    }

    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, {
        ok: false,
        error: 'Opportunity not found',
      });
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
