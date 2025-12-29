import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand, QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { AnswerItem, CreateAnswerDTO, CreateAnswerDTOSchema, } from '../schemas/answer';
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

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event?.body || '');

    const validationResult = CreateAnswerDTOSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const dto: CreateAnswerDTO = validationResult.data;

    const savedAnswer = await saveAnswer(dto);

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

export async function saveAnswer(dto: Partial<AnswerItem>): Promise<AnswerItem> {
  const now = new Date().toISOString();
  const { questionId, text, projectId, organizationId, source, documentId } = dto;

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

    const updateRes = await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
        UpdateExpression:
          'SET #text = :text, #organizationId = :organizationId, #updatedAt = :updatedAt, #source = :source',
        ExpressionAttributeNames: {
          '#text': 'text',
          '#organizationId': 'organizationId',
          '#updatedAt': 'updatedAt',
          '#source': 'source',
        },
        ExpressionAttributeValues: {
          ':text': text,
          ':organizationId': organizationId ?? null,
          ':updatedAt': now,
          ':source': source,
        },
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
    source: source || 'manual',
    documentId: documentId,

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