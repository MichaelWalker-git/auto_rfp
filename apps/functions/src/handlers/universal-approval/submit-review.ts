import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  getUniversalApprovalRecord,
  updateUniversalApprovalStatus,
} from '@/helpers/universal-approval';
import { getUserByOrgAndId } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { SubmitUniversalReviewSchema, getEntityDisplayName, getEntityIcon, getAuditResourceType } from '@auto-rfp/core';
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
  const { success, data, error } = SubmitUniversalReviewSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const reviewerId = getUserId(event) ?? 'system';

  // ── Load the approval record ──
  const approval = await getUniversalApprovalRecord(orgId, data.entityType, data.entityId, data.approvalId);
  if (!approval) return apiResponse(404, { message: 'Approval not found' });

  // ── Guard: only the assigned reviewer can submit a review ──
  if (approval.reviewerId !== reviewerId) {
    return apiResponse(403, { message: 'You are not authorized to review this entity' });
  }

  // ── Guard: can only review PENDING approvals ──
  if (approval.status !== 'PENDING') {
    return apiResponse(400, { message: `Cannot review approval with status: ${approval.status}` });
  }

  // ── Load reviewer and requester for notifications ──
  const [reviewer, requester] = await Promise.all([
    getUserByOrgAndId(orgId, reviewerId).catch(() => null),
    getUserByOrgAndId(orgId, approval.requestedBy).catch(() => null),
  ]);

  const reviewerName = reviewer?.displayName ?? reviewer?.firstName ?? reviewer?.email ?? reviewerId;
  const requesterName = requester?.displayName ?? requester?.firstName ?? requester?.email ?? approval.requestedBy;

  // ── Update approval status ──
  const updatedApproval = await updateUniversalApprovalStatus(
    orgId,
    data.entityType,
    approval.entitySK,
    data.approvalId,
    {
      status: data.decision,
      reviewedAt: nowIso(),
      reviewNote: data.reviewNote,
    },
  );

  // ── Notify requester (non-blocking) ──
  const entityDisplayName = getEntityDisplayName(data.entityType);
  const entityIcon = getEntityIcon(data.entityType);
  const isApproved = data.decision === 'APPROVED';
  
  sendNotification(
    buildNotification(
      'DOCUMENT_APPROVAL_REQUESTED', // Using existing notification type for compatibility
      `${entityIcon} ${entityDisplayName} ${isApproved ? 'Approved' : 'Rejected'}`,
      isApproved 
        ? `${reviewerName} has approved "${approval.entityName ?? `your ${entityDisplayName.toLowerCase()}`}"`
        : `${reviewerName} has rejected "${approval.entityName ?? `your ${entityDisplayName.toLowerCase()}`}"${data.reviewNote ? `: ${data.reviewNote}` : ''}`,
      {
        orgId,
        projectId: data.projectId ?? '',
        entityId: data.entityId,
        recipientUserIds: [approval.requestedBy],
        recipientEmails: requester?.email ? [requester.email] : [],
        actorDisplayName: reviewerName,
      },
    ),
  ).catch((err) => console.warn('[submit-universal-review] Notification failed:', (err as Error).message));

  // ── Audit log (non-blocking) ──
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId: reviewerId,
      userName: reviewerName,
      organizationId: orgId,
      action: isApproved ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED', // Using existing actions for compatibility
      resource: getAuditResourceType(data.entityType),
      resourceId: data.entityId,
      changes: {
        before: {
          status: approval.status,
        },
        after: {
          status: data.decision,
          reviewNote: data.reviewNote,
          reviewedAt: updatedApproval.reviewedAt,
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[submit-universal-review] Audit log failed:', (err as Error).message));

  setAuditContext(event, {
    action: isApproved ? 'DOCUMENT_APPROVED' : 'DOCUMENT_REJECTED',
    resource: getAuditResourceType(data.entityType),
    resourceId: data.entityId,
    orgId,
  });

  return apiResponse(200, { ok: true, approval: updatedApproval });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit')) // Using existing permission for now
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);