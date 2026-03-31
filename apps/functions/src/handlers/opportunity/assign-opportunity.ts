import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';
import { getUserProjectAccessRecord } from '@/helpers/user-project';
import { getUserByOrgAndId } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { resolveUserNames } from '@/helpers/resolve-users';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

// Local schema until core package is rebuilt
const AssignOpportunityBodySchema = z.object({
  orgId:      z.string().min(1),
  projectId:  z.string().min(1),
  oppId:      z.string().min(1),
  assigneeId: z.string().min(1).nullable(),
});

/**
 * Assign (or unassign) an opportunity to a user.
 * POST /opportunity/assign
 *
 * Body: { orgId, projectId, oppId, assigneeId (or null to unassign) }
 *
 * - Assignee must have access to the project
 * - Sends OPPORTUNITY_ASSIGNED notification to the assignee
 */
export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = AssignOpportunityBodySchema.safeParse(raw);
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { projectId, oppId, assigneeId } = data;
  const orgId = data.orgId || getOrgId(event);
  const assignerUserId = getUserId(event);

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!assignerUserId) return apiResponse(401, { message: 'Unauthorized' });

  // 1. Get the opportunity
  const oppResult = await getOpportunity({ orgId, projectId, oppId });
  if (!oppResult) {
    return apiResponse(404, { message: 'Opportunity not found' });
  }

  const opportunity = oppResult.item;
  const previousAssigneeId = (opportunity as Record<string, unknown>)['assigneeId'] as string | undefined;

  // 2. If assigning (not unassigning), verify assignee has project access
  let assigneeName: string | null = null;
  let assigneeEmail: string | null = null;

  if (assigneeId) {
    const accessRecord = await getUserProjectAccessRecord(assigneeId, projectId);
    if (!accessRecord.hasAccess) {
      return apiResponse(400, {
        message: 'Assignee does not have access to this project',
      });
    }

    // Get assignee details for notification and storage
    const assigneeUser = await getUserByOrgAndId(orgId, assigneeId);
    if (assigneeUser) {
      const firstName = assigneeUser.firstName ?? '';
      const lastName = assigneeUser.lastName ?? '';
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      assigneeName = assigneeUser.displayName ?? (fullName || assigneeUser.email);
      assigneeEmail = assigneeUser.email;
    }
  }

  // 3. Get assigner's display name
  const nameMap = await resolveUserNames(orgId, [assignerUserId]);
  const assignerName = nameMap[assignerUserId] ?? 'Unknown user';

  // 4. Update the opportunity with assignment fields
  // Cast to any to allow new fields that may not be in the compiled type yet
  const patch: Record<string, unknown> = assigneeId
    ? {
        assigneeId,
        assigneeName,
        assignedByUserId: assignerUserId,
        assignedByName: assignerName,
      }
    : {
        assigneeId: null,
        assigneeName: null,
        assignedByUserId: null,
        assignedByName: null,
      };

  const { item: updatedOpportunity } = await updateOpportunity({
    orgId,
    projectId,
    oppId,
    patch: patch as Parameters<typeof updateOpportunity>[0]['patch'],
    userContext: { userId: assignerUserId, userName: assignerName },
  });

  // 5. Send notification to assignee (only if assigning, not unassigning)
  if (assigneeId && assigneeId !== assignerUserId) {
    await sendNotification(
      buildNotification(
        'OPPORTUNITY_ASSIGNED',
        `${assignerName} assigned you an opportunity`,
        `You have been assigned to work on "${opportunity.title}".`,
        {
          orgId,
          projectId,
          entityId: oppId,
          recipientUserIds: [assigneeId],
          recipientEmails: assigneeEmail ? [assigneeEmail] : [],
          actorDisplayName: assignerName,
        },
      ),
    );
  }

  // 6. Audit log
  setAuditContext(event, {
    action: assigneeId ? 'OPPORTUNITY_ASSIGNED' : 'OPPORTUNITY_UNASSIGNED',
    resource: 'opportunity',
    resourceId: oppId,
    orgId,
    changes: {
      before: { assigneeId: previousAssigneeId },
      after: { assigneeId: assigneeId },
    },
  });

  const result = updatedOpportunity as Record<string, unknown>;
  return apiResponse(200, {
    ok: true,
    oppId,
    assigneeId: result['assigneeId'],
    assigneeName: result['assigneeName'],
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
