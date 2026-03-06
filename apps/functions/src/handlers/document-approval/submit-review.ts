import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApprovalRecord, updateApprovalStatus } from '@/helpers/document-approval';
import { getRFPDocument } from '@/helpers/rfp-document';
import { getUserByOrgAndId } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { reassignLinearTicket } from '@/helpers/linear';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { SubmitDocumentReviewSchema } from '@auto-rfp/core';
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
  const { success, data, error } = SubmitDocumentReviewSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const reviewerId = getUserId(event) ?? 'system';
  const reviewerName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? reviewerId;

  // ── Load approval record ──
  const approval = await getApprovalRecord(
    orgId, data.projectId, data.opportunityId, data.documentId, data.approvalId,
  );
  if (!approval) return apiResponse(404, { message: 'Approval request not found' });
  if (approval.status !== 'PENDING') {
    return apiResponse(409, { message: `Approval is already ${approval.status.toLowerCase()}` });
  }

  // ── Guard: only the assigned reviewer can submit the review ──
  if (approval.reviewerId !== reviewerId) {
    return apiResponse(403, { message: 'Only the assigned reviewer can submit this review' });
  }

  // ── Load document ──
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc['deletedAt']) return apiResponse(404, { message: 'Document not found' });

  const now = nowIso();

  // ── Update approval record ──
  const updated = await updateApprovalStatus(
    orgId, data.projectId, data.opportunityId, data.documentId, data.approvalId,
    {
      status: data.decision,
      reviewedAt: now,
      reviewNote: data.reviewNote,
    },
  );

  // ── Reassign Linear ticket back to the requester (non-blocking) ──
  if (approval.linearTicketId) {
    const decisionLabel = data.decision === 'APPROVED' ? '✅ Approved' : '❌ Rejected';
    const commentBody = [
      `## Review ${decisionLabel}`,
      ``,
      `**Reviewer:** ${reviewerName}`,
      `**Decision:** ${data.decision}`,
      ...(data.reviewNote ? [`**Reason:** ${data.reviewNote}`] : []),
      ``,
      `This ticket has been reassigned back to the original requester.`,
    ].join('\n');

    reassignLinearTicket(
      orgId,
      approval.linearTicketId,
      approval.requestedBy,
      commentBody,
    ).catch((err) => console.warn('[submit-review] Linear reassignment failed:', (err as Error).message));
  }

  // ── Notify the requester (non-blocking) ──
  const requester = await getUserByOrgAndId(orgId, approval.requestedBy).catch(() => null);
  const notificationType = data.decision === 'APPROVED' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED';
  const notificationTitle = data.decision === 'APPROVED'
    ? '✅ Document Approved'
    : '❌ Document Rejected';
  const notificationMessage = data.decision === 'APPROVED'
    ? `${reviewerName} approved "${doc['name'] ?? doc['title'] ?? 'your document'}"${data.reviewNote ? `: ${data.reviewNote}` : ''}`
    : `${reviewerName} rejected "${doc['name'] ?? doc['title'] ?? 'your document'}"${data.reviewNote ? `: ${data.reviewNote}` : ''}`;

  sendNotification(
    buildNotification(
      notificationType,
      notificationTitle,
      notificationMessage,
      {
        orgId,
        projectId: data.projectId,
        entityId: data.documentId,
        recipientUserIds: [approval.requestedBy],
        recipientEmails: requester?.email ? [requester.email] : [],
        actorDisplayName: reviewerName,
      },
    ),
  ).catch((err) => console.warn('[submit-review] Notification failed:', (err as Error).message));

  // ── Audit log (non-blocking) ──
  const auditAction = data.decision === 'APPROVED' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED';
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: now,
      userId: reviewerId,
      userName: reviewerName,
      organizationId: orgId,
      action: auditAction,
      resource: 'document',
      resourceId: data.documentId,
      changes: {
        before: { status: 'PENDING' },
        after: {
          status: data.decision,
          reviewNote: data.reviewNote,
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[submit-review] Audit log failed:', (err as Error).message));

  setAuditContext(event, {
    action: auditAction,
    resource: 'document',
    resourceId: data.documentId,
    orgId,
  });

  return apiResponse(200, { ok: true, approval: updated });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
