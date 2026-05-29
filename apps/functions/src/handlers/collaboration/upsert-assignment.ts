import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { UpsertAssignmentDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { buildAssignmentSK, createActivity } from '@/helpers/collaboration';
import { putItem } from '@/helpers/db';
import { PK } from '@/constants/collaboration';
import { withSentryLambda } from '@/sentry-lambda';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { getUserByOrgAndId } from '@/helpers/user';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import type { AssignmentItem } from '@auto-rfp/core';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = UpsertAssignmentDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  // orgId comes from the request body — the client always sends it
  const orgId = data.orgId ?? event.queryStringParameters?.orgId;
  const assignedByUserId = event.auth?.userId;

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!assignedByUserId) return apiResponse(401, { message: 'Unauthorized' });

  // Resolve display name from JWT claims
  const claims = event.auth?.claims ?? {};
  const firstName = (claims['given_name'] as string | undefined) ?? '';
  const lastName = (claims['family_name'] as string | undefined) ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const displayName =
    fullName ||
    (claims['name'] as string | undefined) ||
    (claims['email'] as string | undefined) ||
    assignedByUserId;

  const now = new Date().toISOString();
  const assignedToUserId = data.assignedToUserId ?? assignedByUserId;

  // Use per-user SK so multiple users can have assignments on the same question
  const sk = buildAssignmentSK(orgId, data.projectId, data.questionId, assignedToUserId);

  const item: AssignmentItem = {
    assignmentId: uuidv4(),
    projectId: data.projectId,
    orgId,
    questionId: data.questionId,
    assignedToUserId,
    assignedToDisplayName: displayName,
    assignedByUserId,
    status: data.status,
    dueAt: data.dueAt,
    createdAt: now,
    updatedAt: now,
  };

  await putItem<AssignmentItem>(PK.ASSIGNMENT, sk, item);

  // Log activity for status changes
  const action = data.status === 'APPROVED' ? 'ANSWER_APPROVED' : 'QUESTION_ASSIGNED';
  const target =
    data.status === 'UNASSIGNED'
      ? `unassigned question ${data.questionId}`
      : data.status === 'APPROVED'
      ? `approved answer for question ${data.questionId}`
      : `question ${data.questionId} → ${data.status.replace('_', ' ').toLowerCase()}`;

  await createActivity(orgId, {
    activityId: uuidv4(),
    projectId: data.projectId,
    orgId,
    userId: assignedByUserId,
    displayName,
    action,
    target,
    targetId: data.questionId,
    timestamp: now,
  }).catch((err) => {
    console.warn('Failed to log assignment activity:', err);
  });

  // Send ASSIGNMENT notification to the assigned user (if different from assigner)
  if (data.assignedToUserId && data.assignedToUserId !== assignedByUserId && data.status === 'ASSIGNED') {
    const assignedUser = await getUserByOrgAndId(orgId, data.assignedToUserId).catch(() => null);
    if (assignedUser) {
      await sendNotification(
        buildNotification(
          'ASSIGNMENT',
          `${displayName} assigned you a question`,
          `You have been assigned question ${data.questionId} in project ${data.projectId}.`,
          {
            orgId,
            projectId: data.projectId,
            recipientUserIds: [data.assignedToUserId],
            recipientEmails: [assignedUser.email],
            actorDisplayName: displayName,
          },
        ),
      );
    }
  }

  return apiResponse(200, item);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:edit'))
    .use(httpErrorMiddleware()),
);
