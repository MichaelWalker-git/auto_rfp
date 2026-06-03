import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { AnswerItem, AnswerResolution, ConfidenceBreakdown, ConfidenceBand, SaveAnswerDTOSchema } from '@auto-rfp/core';
import { ANSWER_PK } from '@/constants/answer';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { DBItem, docClient, updateItem } from '@/helpers/db';
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { nowIso } from '@/helpers/date';
import { createActivity } from '@/helpers/collaboration';
import { buildQuestionSK } from '@/helpers/question';

// Resolved lazily so tests can set process.env before module-level code runs
const getTableName = () => requireEnv('DB_TABLE_NAME');

export const saveAnswer = async (dto: Partial<AnswerItem> & {
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: ConfidenceBand;
  resolution?: AnswerResolution;
  linkedToMasterQuestionId?: string;
  status?: 'DRAFT' | 'APPROVED';
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
  opportunityId?: string;
  questionFileId?: string;
}): Promise<AnswerItem> => {
  const now = nowIso();
  const {
    questionId,
    text,
    projectId,
    organizationId,
    sources,
    confidence,
    confidenceBreakdown,
    confidenceBand,
    resolution,
    linkedToMasterQuestionId,
    status,
    approvedBy,
    approvedByName,
    approvedAt,
    updatedBy,
    updatedByName,
    opportunityId,
    questionFileId,
  } = dto;

  // Build exact SK when opportunityId + fileId are known
  const fileId = questionFileId ?? '';
  const skExact = opportunityId
    ? buildQuestionSK(projectId ?? '', opportunityId, fileId, questionId ?? '')
    : null;
  const skPrefix = skExact ?? `${projectId}#`;

  // Look up existing answer
  const queryRes = await docClient.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: skExact
        ? '#pk = :pk AND #sk = :sk'
        : '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: skExact
        ? { ':pk': ANSWER_PK, ':sk': skExact }
        : { ':pk': ANSWER_PK, ':skPrefix': skPrefix },
      Limit: 1,
    }),
  );

  const existing = (queryRes.Items?.[0] as (AnswerItem & DBItem) | undefined) ?? undefined;

  if (existing) {
    const updates: Record<string, unknown> = {
      text,
      organizationId: organizationId ?? null,
      sources: sources || [],
      updatedAt: now,
    };
    if (status !== undefined) updates.status = status;
    if (approvedBy !== undefined) updates.approvedBy = approvedBy;
    if (approvedByName !== undefined) updates.approvedByName = approvedByName;
    if (approvedAt !== undefined) updates.approvedAt = approvedAt;
    if (confidence !== undefined) updates.confidence = confidence;
    if (confidenceBreakdown) updates.confidenceBreakdown = confidenceBreakdown;
    if (confidenceBand) updates.confidenceBand = confidenceBand;
    if (resolution !== undefined) updates.resolution = resolution;
    if (updatedBy !== undefined) updates.updatedBy = updatedBy;
    if (updatedByName !== undefined) updates.updatedByName = updatedByName;
    if (linkedToMasterQuestionId) updates.linkedToMasterQuestionId = linkedToMasterQuestionId;

    const updated = await updateItem<AnswerItem>(
      ANSWER_PK,
      existing[SK_NAME],
      updates,
      { returnValues: 'ALL_NEW' },
    );
    return updated;
  }

  // Create new answer
  const answerId = uuidv4();
  const sortKey = skExact ?? `${projectId}#${questionId}#${answerId}`;

  const answerItem = {
    id: answerId,
    questionId: questionId!,
    projectId,
    organizationId,
    text: text || '',
    status: status ?? 'DRAFT',
    confidence,
    confidenceBreakdown,
    confidenceBand,
    ...(resolution !== undefined && { resolution }),
    sources,
    ...(approvedBy && { approvedBy }),
    ...(approvedByName && { approvedByName }),
    ...(approvedAt && { approvedAt }),
    ...(updatedBy && { updatedBy }),
    ...(updatedByName && { updatedByName }),
    ...(linkedToMasterQuestionId && { linkedToMasterQuestionId }),
  };

  await docClient.send(
    new PutCommand({
      TableName: getTableName(),
      Item: { [PK_NAME]: ANSWER_PK, [SK_NAME]: sortKey, ...answerItem, createdAt: now, updatedAt: now },
    }),
  );
  return { ...answerItem, createdAt: now, updatedAt: now } as AnswerItem;
};

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? 'unknown';
  console.log(`[save-answer] START requestId=${requestId}`);

  if (!event.body) {
    console.log(`[save-answer] ERROR requestId=${requestId} - Missing request body`);
    return apiResponse(400, { message: 'Request body is required' });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(event.body);
  } catch (parseErr) {
    console.log(`[save-answer] ERROR requestId=${requestId} - JSON parse failed: ${(parseErr as Error).message}`);
    return apiResponse(400, { message: 'Invalid JSON in request body' });
  }

  const { success, data, error } = SaveAnswerDTOSchema.safeParse(parsedBody);
  if (!success) {
    console.log(`[save-answer] ERROR requestId=${requestId} - Validation failed:`, JSON.stringify(error.issues));
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  console.log(`[save-answer] requestId=${requestId} questionId=${data.questionId} projectId=${data.projectId} status=${data.status ?? 'DRAFT'}`);

  const userId = event.auth?.userId;
  const claims = event.auth?.claims ?? {};
  const firstName = (claims['given_name'] as string | undefined) ?? '';
  const lastName = (claims['family_name'] as string | undefined) ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const displayName =
    fullName ||
    (claims['name'] as string | undefined) ||
    (claims['email'] as string | undefined) ||
    userId ||
    'Unknown';

  const isApproving = data.status === 'APPROVED';
  const now = nowIso();

  let savedAnswer: AnswerItem;
  try {
    savedAnswer = await saveAnswer({
      ...data,
      updatedBy: userId,
      updatedByName: displayName,
      ...(isApproving && userId
        ? { approvedBy: userId, approvedByName: displayName, approvedAt: now }
        : {}),
    });
    console.log(`[save-answer] SUCCESS requestId=${requestId} questionId=${data.questionId} answerId=${savedAnswer.id} isApproving=${isApproving}`);
  } catch (saveErr) {
    console.error(`[save-answer] ERROR requestId=${requestId} questionId=${data.questionId} - DynamoDB save failed:`, (saveErr as Error).message, (saveErr as Error).stack);
    throw saveErr; // Re-throw to let httpErrorMiddleware handle it
  }

  // Log activity to the collaboration feed (non-blocking)
  const orgId = data.organizationId ?? event.queryStringParameters?.orgId;
  if (orgId && data.projectId && userId) {
    const action = isApproving ? 'ANSWER_APPROVED' : 'ANSWER_EDITED';
    createActivity(orgId, {
      activityId: uuidv4(),
      projectId: data.projectId,
      orgId,
      userId,
      displayName,
      action,
      target: `answer for question ${data.questionId}`,
      targetId: data.questionId,
      timestamp: now,
    }).catch((err) => console.warn('Failed to log activity:', err));
  }

  setAuditContext(event, {
    action: 'ANSWER_EDITED',
    resource: 'answer',
    resourceId: data.questionId ?? 'unknown',
  });

  return apiResponse(200, savedAnswer);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
