import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getApprovalRecord, updateApprovalStatus } from '@/helpers/document-approval';
import { updateRFPDocumentMetadata } from '@/helpers/rfp-document';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { reassignLinearTicket } from '@/helpers/linear';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { BulkSubmitDocumentReviewSchema } from '@auto-rfp/core';
import type { BulkReviewItem } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

interface BulkReviewResult {
  documentId: string;
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  success: boolean;
  error?: string;
}

const processReview = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  review: BulkReviewItem,
  reviewerId: string,
  reviewerName: string,
): Promise<BulkReviewResult> => {
  try {
    // Load approval record
    const approval = await getApprovalRecord(
      orgId, projectId, opportunityId, review.documentId, review.approvalId,
    );
    if (!approval) {
      return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: false, error: 'Approval not found' };
    }
    if (approval.status !== 'PENDING') {
      return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: false, error: `Already ${approval.status.toLowerCase()}` };
    }
    if (approval.reviewerId !== reviewerId) {
      return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: false, error: 'Not the assigned reviewer' };
    }

    const now = nowIso();

    // Update approval record
    await updateApprovalStatus(
      orgId, projectId, opportunityId, review.documentId, review.approvalId,
      { status: review.decision, reviewedAt: now, reviewNote: review.reviewNote },
    );

    // Update document signatureStatus (blocking — gates submission)
    const newSignatureStatus = review.decision === 'APPROVED' ? 'FULLY_SIGNED' : 'PENDING_SIGNATURE';
    await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId: review.documentId,
      updates: { signatureStatus: newSignatureStatus },
      updatedBy: reviewerId,
    });

    // Reassign Linear ticket (non-blocking)
    if (approval.linearTicketId) {
      const decisionLabel = review.decision === 'APPROVED' ? '✅ Approved' : '❌ Rejected';
      const commentBody = [
        `## ${decisionLabel} (Bulk Review)`,
        `**Reviewer:** ${reviewerName}`,
        ...(review.reviewNote ? [`**Note:** ${review.reviewNote}`] : []),
      ].join('\n');

      reassignLinearTicket(orgId, approval.linearTicketId, approval.requestedBy, commentBody)
        .catch((err) => console.warn(`[bulk-review] Linear reassignment failed for ${review.documentId}:`, (err as Error).message));
    }

    // Notify requester (non-blocking)
    const notificationType = review.decision === 'APPROVED' ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED';
    const notificationTitle = review.decision === 'APPROVED' ? '✅ Document Approved' : '❌ Document Rejected';
    sendNotification(
      buildNotification(notificationType, notificationTitle,
        `${reviewerName} ${review.decision.toLowerCase()} "${approval.documentName ?? 'a document'}"${review.reviewNote ? `: ${review.reviewNote}` : ''}`,
        {
          orgId, projectId, entityId: review.documentId,
          recipientUserIds: [approval.requestedBy],
          actorDisplayName: reviewerName,
        },
      ),
    ).catch((err) => console.warn(`[bulk-review] Notification failed for ${review.documentId}:`, (err as Error).message));

    return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: true };
  } catch (err) {
    return { documentId: review.documentId, approvalId: review.approvalId, decision: review.decision, success: false, error: (err as Error).message };
  }
};

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = BulkSubmitDocumentReviewSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const reviewerId = getUserId(event) ?? 'system';
  const reviewerName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? reviewerId;

  // Process all reviews in parallel
  const results = await Promise.all(
    data.reviews.map((review) =>
      processReview(orgId, data.projectId, data.opportunityId, review, reviewerId, reviewerName),
    ),
  );

  const totalApproved = results.filter((r) => r.success && r.decision === 'APPROVED').length;
  const totalRejected = results.filter((r) => r.success && r.decision === 'REJECTED').length;
  const totalFailed = results.filter((r) => !r.success).length;

  // Audit log (non-blocking)
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId: reviewerId,
      userName: reviewerName,
      organizationId: orgId,
      action: 'DOCUMENT_BULK_REVIEWED',
      resource: 'document',
      resourceId: `bulk-${data.projectId}-${data.opportunityId}`,
      changes: {
        after: { totalApproved, totalRejected, totalFailed, documentIds: data.reviews.map((r) => r.documentId) },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: totalFailed === 0 ? 'success' : 'failure',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[bulk-review] Audit log failed:', (err as Error).message));

  setAuditContext(event, {
    action: 'DOCUMENT_BULK_REVIEWED',
    resource: 'document',
    resourceId: `bulk-${data.projectId}-${data.opportunityId}`,
    orgId,
  });

  return apiResponse(200, { results, totalApproved, totalRejected, totalFailed });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
