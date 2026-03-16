import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApprovalRecord, updateApprovalStatus, createApprovalRecord } from '@/helpers/document-approval';
import { getRFPDocument } from '@/helpers/rfp-document';
import { getUserByOrgAndId } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { reassignLinearTicket } from '@/helpers/linear';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { ResubmitForReviewSchema } from '@auto-rfp/core';
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
  const { success, data, error } = ResubmitForReviewSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const userId = getUserId(event) ?? 'system';
  const userName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? userId;

  // ── Load approval record ──
  const approval = await getApprovalRecord(
    orgId, data.projectId, data.opportunityId, data.documentId, data.approvalId,
  );
  if (!approval) return apiResponse(404, { message: 'Approval request not found' });

  // ── Guard: only REJECTED approvals can be re-submitted ──
  if (approval.status !== 'REJECTED') {
    return apiResponse(409, {
      message: `Cannot re-submit — approval is ${approval.status.toLowerCase()}, not rejected`,
    });
  }

  // ── Guard: only the original requester can re-submit ──
  if (approval.requestedBy !== userId) {
    return apiResponse(403, { message: 'Only the original requester can re-submit for review' });
  }

  // ── Load document ──
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc['deletedAt']) return apiResponse(404, { message: 'Document not found' });

  // ── Load requester info for proper display name ──
  const requester = await getUserByOrgAndId(orgId, userId).catch(() => null);
  const requestedByName = requester?.displayName ?? requester?.firstName ?? requester?.email ?? userId;

  // ── Create new approval record to preserve history ──
  const newApproval = await createApprovalRecord(
    {
      orgId,
      projectId: data.projectId,
      opportunityId: data.opportunityId,
      documentId: data.documentId,
      reviewerId: approval.reviewerId,
    },
    userId,
    requestedByName,
    approval.reviewerName,
    approval.reviewerEmail,
    (doc['name'] as string | undefined) ?? (doc['title'] as string | undefined),
  );

  // ── Reassign Linear ticket back to reviewer (non-blocking) ──
  if (approval.linearTicketId) {
    const commentBody = [
      `## 🔄 Document Revised — Re-Review Requested`,
      ``,
      `**Requester:** ${userName}`,
      ...(data.revisionNote ? [`**Revision Note:** ${data.revisionNote}`] : []),
      ``,
      `The document has been revised and re-submitted for your review.`,
    ].join('\n');

    reassignLinearTicket(
      orgId,
      approval.linearTicketId,
      approval.reviewerId,
      commentBody,
    ).catch((err) =>
      console.warn('[resubmit-for-review] Linear reassignment failed:', (err as Error).message),
    );
  }

  // ── Notify reviewer (non-blocking) ──
  const reviewer = await getUserByOrgAndId(orgId, approval.reviewerId).catch(() => null);
  sendNotification(
    buildNotification(
      'DOCUMENT_APPROVAL_REQUESTED',
      '🔄 Document Revised — Re-Review Requested',
      `${userName} has revised "${doc['name'] ?? doc['title'] ?? 'a document'}" and re-submitted it for your review`,
      {
        orgId,
        projectId: data.projectId,
        entityId: `${data.opportunityId}:${data.documentId}`,
        recipientUserIds: [approval.reviewerId],
        recipientEmails: reviewer?.email ? [reviewer.email] : [],
        actorDisplayName: userName,
      },
    ),
  ).catch((err) =>
    console.warn('[resubmit-for-review] Notification failed:', (err as Error).message),
  );

  // ── Audit log (non-blocking) ──
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId,
      userName,
      organizationId: orgId,
      action: 'DOCUMENT_REVISION_RESUBMITTED',
      resource: 'document',
      resourceId: data.documentId,
      changes: {
        before: { status: 'REJECTED' },
        after: { status: 'PENDING', revisionNote: data.revisionNote },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) =>
    console.warn('[resubmit-for-review] Audit log failed:', (err as Error).message),
  );

  setAuditContext(event, {
    action: 'DOCUMENT_REVISION_RESUBMITTED',
    resource: 'document',
    resourceId: data.documentId,
    orgId,
  });

  return apiResponse(200, { ok: true, approval: newApproval });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
