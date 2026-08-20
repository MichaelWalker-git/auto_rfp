import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getUserId } from '@/helpers/api';
import {
  getFoiaAutomation,
  transitionFoiaAutomationState,
  syncOpportunityFoiaMarker,
} from '@/helpers/foia-automation';
import { getOpportunity } from '@/helpers/opportunity';
import { getSubmissionHistory } from '@/helpers/proposal-submission';
import { FoiaAutomationUpdateRequestSchema, computeFoiaScheduledSendAt } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event) ?? 'system';

  const { success, data, error } = FoiaAutomationUpdateRequestSchema.safeParse(
    JSON.parse(event.body ?? '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { orgId, projectId, oppId, cancel, markManualCompleted, delayDaysOverride, scheduledSendAt } = data;

  // Cancel requested
  if (cancel === true) {
    const result = await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: ['SCHEDULED', 'BLOCKED', 'AWAITING_APPROVAL', 'STALLED', 'NOT_APPLICABLE'],
      to: 'SUPPRESSED',
      patch: { suppressedReason: 'Cancelled by user' },
      updatedBy: userId,
    });

    if (result === null) {
      return apiResponse(409, {
        message: 'Automation state changed concurrently. Refresh and try again.',
      });
    }

    await syncOpportunityFoiaMarker(orgId, projectId, oppId, result.state);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'foia_request',
      resourceId: oppId,
    });

    return apiResponse(200, { automation: result });
  }

  // Mark manual completed
  if (markManualCompleted === true) {
    const result = await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: ['SCHEDULED', 'BLOCKED', 'AWAITING_APPROVAL', 'STALLED', 'NOT_APPLICABLE'],
      to: 'MANUAL_COMPLETED',
      updatedBy: userId,
    });

    if (result === null) {
      return apiResponse(409, {
        message: 'Automation state changed concurrently. Refresh and try again.',
      });
    }

    await syncOpportunityFoiaMarker(orgId, projectId, oppId, result.state);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'foia_request',
      resourceId: oppId,
    });

    return apiResponse(200, { automation: result });
  }

  // Delay or schedule patch
  const existing = await getFoiaAutomation(orgId, projectId, oppId);
  if (!existing) {
    return apiResponse(404, { message: 'Automation record not found' });
  }

  let recomputedScheduledSendAt: string | null | undefined = scheduledSendAt;

  // Recompute scheduledSendAt if delayDaysOverride changed but scheduledSendAt not supplied
  if (delayDaysOverride !== undefined && scheduledSendAt === undefined) {
    const opportunityRes = await getOpportunity({ orgId, projectId, oppId });
    if (!opportunityRes) {
      return apiResponse(404, { message: 'Opportunity not found' });
    }

    const submissions = await getSubmissionHistory(orgId, projectId, oppId);
    const latestSubmission = submissions[0];

    recomputedScheduledSendAt = computeFoiaScheduledSendAt({
      submittedAt: latestSubmission?.submittedAt ?? null,
      responseDeadlineIso: opportunityRes.item.responseDeadlineIso ?? null,
      delayDays: delayDaysOverride ?? 0,
    });
  }

  const patch: Record<string, unknown> = {};
  if (delayDaysOverride !== undefined) patch.delayDaysOverride = delayDaysOverride;
  if (recomputedScheduledSendAt !== undefined) patch.scheduledSendAt = recomputedScheduledSendAt;

  // Only transition to SCHEDULED if currently in certain states
  const currentState = existing.state;
  if (['SCHEDULED', 'BLOCKED', 'NOT_APPLICABLE'].includes(currentState)) {
    const result = await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: ['SCHEDULED', 'BLOCKED', 'NOT_APPLICABLE'],
      to: 'SCHEDULED',
      patch: { ...patch, blockedReason: null },
      updatedBy: userId,
    });

    if (result === null) {
      return apiResponse(409, {
        message: 'Automation state changed concurrently. Refresh and try again.',
      });
    }

    await syncOpportunityFoiaMarker(orgId, projectId, oppId, result.state);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'foia_request',
      resourceId: oppId,
    });

    return apiResponse(200, { automation: result });
  }

  // For other states, just update the patch without state transition
  const result = await transitionFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    from: currentState,
    to: currentState,
    patch,
    updatedBy: userId,
  });

  if (result === null) {
    return apiResponse(409, {
      message: 'Automation state changed concurrently. Refresh and try again.',
    });
  }

  setAuditContext(event, {
    action: 'CONFIG_CHANGED',
    resource: 'foia_request',
    resourceId: oppId,
  });

  return apiResponse(200, { automation: result });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
