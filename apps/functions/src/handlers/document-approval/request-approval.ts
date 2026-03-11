import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  createApprovalRecord,
  cancelPendingApprovals,
  updateApprovalLinearTicket,
} from '@/helpers/document-approval';
import { getRFPDocument } from '@/helpers/rfp-document';
import { getUserByOrgAndId } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { createLinearTicket } from '@/helpers/linear';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { RequestDocumentApprovalSchema } from '@auto-rfp/core';
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
  const { success, data, error } = RequestDocumentApprovalSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const requestedBy = getUserId(event) ?? 'system';
  const requestedByName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? requestedBy;

  // ── Guard: cannot request approval from yourself ──
  if (data.reviewerId === requestedBy) {
    return apiResponse(400, { message: 'You cannot request approval from yourself' });
  }

  // ── Load document ──
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc['deletedAt']) return apiResponse(404, { message: 'Document not found' });
  if (doc['orgId'] !== orgId) return apiResponse(403, { message: 'Access denied' });

  // ── Load reviewer ──
  const reviewer = await getUserByOrgAndId(orgId, data.reviewerId);
  if (!reviewer) return apiResponse(404, { message: 'Reviewer not found in this organization' });

  // ── Cancel any existing PENDING approvals for this document ──
  await cancelPendingApprovals(orgId, data.projectId, data.opportunityId, data.documentId);

  // ── Create approval record ──
  const approval = await createApprovalRecord(
    data,
    requestedBy,
    requestedByName,
    reviewer.displayName ?? reviewer.firstName ?? reviewer.email,
    reviewer.email,
    (doc['name'] as string | undefined) ?? (doc['title'] as string | undefined),
  );

  // ── Create Linear ticket for the reviewer (non-blocking) ──
  createLinearTicket({
    orgId,
    title: `[Review] ${doc['name'] ?? doc['title'] ?? 'Document'} — Approval Required`,
    description: [
      `## Document Approval Request`,
      ``,
      `**Document:** ${doc['name'] ?? doc['title'] ?? 'Untitled'}`,
      `**Type:** ${doc['documentType'] ?? 'Unknown'}`,
      `**Requested by:** ${requestedByName}`,
      `**Requested at:** ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
      ``,
      `## Instructions`,
      `1. Review the document in Auto RFP`,
      `2. Click **Approve** or **Reject** in the document approval panel`,
      `3. The ticket will be reassigned back to the requester automatically`,
      ``,
      `**Approval ID:** \`${approval.approvalId}\``,
    ].join('\n'),
    priority: 2,
    labels: ['document-review', 'Auto-Generated'],
  })
    .then(async (ticket) => {
      if (!ticket) return;
      // Store the Linear ticket reference on the approval record (status stays PENDING)
      await updateApprovalLinearTicket(
        orgId, data.projectId, data.opportunityId, data.documentId, approval.approvalId,
        {
          linearTicketId: ticket.id,
          linearTicketIdentifier: ticket.identifier ?? undefined,
          linearTicketUrl: ticket.url ?? undefined,
        },
      );
    })
    .catch((err) => console.warn('[request-approval] Linear ticket creation failed:', (err as Error).message));

  // ── Notify reviewer (non-blocking) ──
  sendNotification(
    buildNotification(
      'DOCUMENT_APPROVAL_REQUESTED',
      '📋 Document Review Requested',
      `${requestedByName} has requested your approval for "${doc['name'] ?? doc['title'] ?? 'a document'}"`,
      {
        orgId,
        projectId: data.projectId,
        entityId: `${data.opportunityId}:${data.documentId}`,
        recipientUserIds: [data.reviewerId],
        recipientEmails: reviewer.email ? [reviewer.email] : [],
        actorDisplayName: requestedByName,
      },
    ),
  ).catch((err) => console.warn('[request-approval] Notification failed:', (err as Error).message));

  // ── Audit log (non-blocking) ──
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId: requestedBy,
      userName: requestedByName,
      organizationId: orgId,
      action: 'DOCUMENT_APPROVAL_REQUESTED',
      resource: 'document',
      resourceId: data.documentId,
      changes: {
        after: {
          approvalId: approval.approvalId,
          reviewerId: data.reviewerId,
          documentName: doc['name'] ?? doc['title'],
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[request-approval] Audit log failed:', (err as Error).message));

  setAuditContext(event, {
    action: 'DOCUMENT_APPROVAL_REQUESTED',
    resource: 'document',
    resourceId: data.documentId,
    orgId,
  });

  return apiResponse(200, { ok: true, approval });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
