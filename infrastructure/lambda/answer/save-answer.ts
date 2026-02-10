import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { AnswerItem, ConfidenceBreakdown, ConfidenceBand, SaveAnswerDTOSchema, } from '@auto-rfp/shared';
import { ANSWER_PK } from '../constants/answer';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { DBItem, docClient } from '../helpers/db';
import { nowIso } from '../helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event?.body || '');

    const { success, data, error } = SaveAnswerDTOSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const savedAnswer = await saveAnswer(data);

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
}): Promise<AnswerItem> {
  const now = nowIso();
  const { questionId, text, projectId, organizationId, sources, confidence, confidenceBreakdown, confidenceBand } = dto;

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

    // Build dynamic update expression to include confidence fields when present
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
    const exprValues: Record<string, any> = {
      ':text': text,
      ':organizationId': organizationId ?? null,
      ':updatedAt': now,
      ':sources': sources || [],
    };

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

  const answerItem: AnswerItem & DBItem = {
    [PK_NAME]: ANSWER_PK,
    [SK_NAME]: sortKey,

    id: answerId,
    questionId: questionId!,
    projectId,
    organizationId,
    text: text || '',
    confidence,
    confidenceBreakdown,
    confidenceBand,
    sources: sources,
    createdAt: now,
    updatedAt: now,
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
    .use(httpErrorMiddleware())
);