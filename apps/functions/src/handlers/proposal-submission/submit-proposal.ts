import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { checkSubmissionReadiness, createSubmissionRecord } from '@/helpers/proposal-submission';
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { getOpportunity } from '@/helpers/opportunity';
import { onProjectOutcomeSet } from '@/helpers/opportunity-stage';
import { getOrgMembers } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { SubmitProposalSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = SubmitProposalSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const userId = getUserId(event) ?? 'system';
  const userName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? userId;

  // ── 1. Load opportunity (for deadline + title) ──
  const opp = await getOpportunity({ orgId: data.orgId, projectId: data.projectId, oppId: data.oppId });
  if (!opp) return apiResponse(404, { message: 'Opportunity not found' });
  const deadlineIso = (opp.item?.responseDeadlineIso as string | undefined) ?? null;
  const currentStage = (opp.item?.stage as string | undefined) ?? null;
  const ignoredCheckIds = (opp.item?.ignoredComplianceCheckIds as string[] | undefined) ?? [];

  // ── 2. Server-side readiness re-validation ──
  const readiness = await checkSubmissionReadiness({
    orgId: data.orgId,
    projectId: data.projectId,
    oppId: data.oppId,
    deadlineIso,
    currentStage,
    ignoredCheckIds,
  });
  if (!readiness.ready && !data.forceSubmit) {
    return apiResponse(422, {
      message: 'Proposal is not ready for submission',
      checks: readiness.checks,
      blockingFails: readiness.blockingFails,
    });
  }

  // ── 3. Collect document IDs (snapshot of what was submitted) ──
  let documentIds = data.documentIds ?? [];
  if (documentIds.length === 0) {
    const { items: docs } = await listRFPDocumentsByProject({
      projectId: data.projectId,
      opportunityId: data.oppId,
    });
    documentIds = docs
      .filter((d) => !d['deletedAt'] && d['status'] !== 'GENERATING')
      .map((d) => d['documentId'] as string);
  }

  // ── 4. Create submission record ──
  const submission = await createSubmissionRecord(data, userId, userName, documentIds, deadlineIso);

  // ── 5. Trigger stage → SUBMITTED + APN registration (non-blocking) ──
  // NOTE: We call onProjectOutcomeSet directly — we do NOT create a ProjectOutcome record.
  // ProjectOutcome is only set when the award decision is known (WON/LOST/NO_BID/WITHDRAWN).
  onProjectOutcomeSet({
    orgId: data.orgId,
    projectId: data.projectId,
    oppId: data.oppId,
    outcomeStatus: 'PENDING',
    changedBy: userId,
  }).catch((err) =>
    console.warn('[submit-proposal] Stage transition failed (non-blocking):', (err as Error).message),
  );

  // ── 6. Notify all org members (non-blocking) ──
  getOrgMembers(data.orgId)
    .then((members) => {
      if (!members.length) return;
      return sendNotification(
        buildNotification(
          'PROPOSAL_SUBMITTED',
          '📤 Proposal Submitted',
          `Proposal for "${(opp.item?.title as string | undefined) ?? data.oppId}" has been submitted.`,
          {
            orgId: data.orgId,
            projectId: data.projectId,
            entityId: data.oppId,
            recipientUserIds: members.map((m) => m.userId),
            recipientEmails: members.map((m) => m.email),
            actorDisplayName: userName,
          },
        ),
      );
    })
    .catch((err) => console.warn('[submit-proposal] Notification failed:', (err as Error).message));

  // ── 7. Audit log (non-blocking) ──
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId,
      userName,
      organizationId: data.orgId,
      action: 'PROPOSAL_SUBMITTED',
      resource: 'proposal',
      resourceId: submission.submissionId,
      changes: {
        after: {
          submissionMethod: data.submissionMethod,
          documentCount: documentIds.length,
          oppId: data.oppId,
          submissionReference: data.submissionReference,
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[submit-proposal] Audit log failed:', (err as Error).message));

  setAuditContext(event, {
    action: 'PROPOSAL_SUBMITTED',
    resource: 'proposal',
    resourceId: submission.submissionId,
    orgId: data.orgId,
  });

  return apiResponse(200, { ok: true, submission });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
