import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { apiResponse } from '@/helpers/api';
import { AnswerItem, ConfidenceBreakdown, ConfidenceBand, SaveAnswerDTOSchema } from '@auto-rfp/core';
import { ANSWER_PK } from '@/constants/answer';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '@/helpers/env';
import { DBItem, docClient } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import { createActivity } from '@/helpers/collaboration';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event?.body || '');

    const { success, data, error: errors } = SaveAnswerDTOSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = errors.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    // Resolve approver identity from JWT claims when approving
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

    const dtoWithApproval = {
      ...data,
      // Always track who last edited
      updatedBy: userId,
      updatedByName: displayName,
      ...(isApproving && userId
        ? {
            approvedBy: userId,
            approvedByName: displayName,
            approvedAt: now,
          }
        : {}),
    };

    const savedAnswer = await saveAnswer(dtoWithApproval);

    // Log activity to the collaboration feed
    const orgId = data.organizationId ?? event.queryStringParameters?.orgId;
    const projectId = data.projectId;
    if (orgId && projectId && userId) {
      const action = isApproving ? 'ANSWER_APPROVED' : 'ANSWER_EDITED';
      await createActivity(orgId, {
        activityId: uuidv4(),
        projectId,
        orgId,
        userId,
        displayName,
        action,
        target: `answer for question ${data.questionId}`,
        targetId: data.questionId,
        timestamp: now,
      }).catch((err) => {
        // Non-fatal — don't fail the save if activity logging fails
        console.warn('Failed to log activity:', err);
      });
    }

    return apiResponse(200, savedAnswer);
  } catch (err) {
    console.error('Error in saveAnswer handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function saveAnswer(dto: Partial<AnswerItem> & {
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: ConfidenceBand;
  linkedToMasterQuestionId?: string;
  status?: 'DRAFT' | 'APPROVED';
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  updatedBy?: string;
  updatedByName?: string;
}): Promise<AnswerItem> {
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
    linkedToMasterQuestionId,
    status,
    approvedBy,
    approvedByName,
    approvedAt,
    updatedBy,
    updatedByName,
  } = dto;

  const skPrefix = `${projectId}#${questionId}#`;

  const queryRes = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': ANSWER_PK,
        ':skPrefix': skPrefix,
      },
      Limit: 1,
    }),
  );

  const existing = (queryRes.Items?.[0] as (AnswerItem & DBItem) | undefined) ?? undefined;

  if (existing) {
    const key = {
      [PK_NAME]: existing[PK_NAME],
      [SK_NAME]: existing[SK_NAME],
    };

    const updateParts = [
      '#text = :text',
      '#organizationId = :organizationId',
      '#updatedAt = :updatedAt',
      '#sources = :sources',
    ];
    const exprNames: Record<string, string> = {
      '#text': 'text',
      '#organizationId': 'organizationId',
      '#updatedAt': 'updatedAt',
      '#sources': 'sources',
    };
    const exprValues: Record<string, unknown> = {
      ':text': text,
      ':organizationId': organizationId ?? null,
      ':updatedAt': now,
      ':sources': sources || [],
    };

    if (status !== undefined) {
      updateParts.push('#status = :status');
      exprNames['#status'] = 'status';
      exprValues[':status'] = status;
    }
    if (approvedBy !== undefined) {
      updateParts.push('#approvedBy = :approvedBy');
      exprNames['#approvedBy'] = 'approvedBy';
      exprValues[':approvedBy'] = approvedBy;
    }
    if (approvedByName !== undefined) {
      updateParts.push('#approvedByName = :approvedByName');
      exprNames['#approvedByName'] = 'approvedByName';
      exprValues[':approvedByName'] = approvedByName;
    }
    if (approvedAt !== undefined) {
      updateParts.push('#approvedAt = :approvedAt');
      exprNames['#approvedAt'] = 'approvedAt';
      exprValues[':approvedAt'] = approvedAt;
    }
    if (confidence !== undefined) {
      updateParts.push('#confidence = :confidence');
      exprNames['#confidence'] = 'confidence';
      exprValues[':confidence'] = confidence;
    }
    if (confidenceBreakdown) {
      updateParts.push('#confidenceBreakdown = :confidenceBreakdown');
      exprNames['#confidenceBreakdown'] = 'confidenceBreakdown';
      exprValues[':confidenceBreakdown'] = confidenceBreakdown;
    }
    if (confidenceBand) {
      updateParts.push('#confidenceBand = :confidenceBand');
      exprNames['#confidenceBand'] = 'confidenceBand';
      exprValues[':confidenceBand'] = confidenceBand;
    }
    if (updatedBy !== undefined) {
      updateParts.push('#updatedBy = :updatedBy');
      exprNames['#updatedBy'] = 'updatedBy';
      exprValues[':updatedBy'] = updatedBy;
    }
    if (updatedByName !== undefined) {
      updateParts.push('#updatedByName = :updatedByName');
      exprNames['#updatedByName'] = 'updatedByName';
      exprValues[':updatedByName'] = updatedByName;
    }
    if (linkedToMasterQuestionId) {
      updateParts.push('#linkedToMasterQuestionId = :linkedToMasterQuestionId');
      exprNames['#linkedToMasterQuestionId'] = 'linkedToMasterQuestionId';
      exprValues[':linkedToMasterQuestionId'] = linkedToMasterQuestionId;
    }

    const updateRes = await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
        UpdateExpression: `SET ${updateParts.join(', ')}`,
        ExpressionAttributeNames: exprNames,
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
      }),
    );

    return updateRes.Attributes as AnswerItem;
  }

  const answerId = uuidv4();
  const sortKey = `${projectId}#${questionId}#${answerId}`;

  const answerItem: AnswerItem & DBItem & {
    linkedToMasterQuestionId?: string;
    status?: string;
    approvedBy?: string;
    approvedByName?: string;
    approvedAt?: string;
  } = {
    [PK_NAME]: ANSWER_PK,
    [SK_NAME]: sortKey,
    id: answerId,
    questionId: questionId!,
    projectId,
    organizationId,
    text: text || '',
    status: status ?? 'DRAFT',
    confidence,
    confidenceBreakdown,
    confidenceBand,
    sources,
    ...(approvedBy && { approvedBy }),
    ...(approvedByName && { approvedByName }),
    ...(approvedAt && { approvedAt }),
    createdAt: now,
    updatedAt: now,
    ...(linkedToMasterQuestionId && { linkedToMasterQuestionId }),
  };

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: answerItem,
    }),
  );

  return answerItem as AnswerItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:edit'))
    .use(httpErrorMiddleware()),
);
