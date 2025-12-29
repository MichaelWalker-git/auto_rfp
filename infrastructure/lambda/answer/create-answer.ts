import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';
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

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME')

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

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

    const newAnswer = await createAnswer(dto);

    return apiResponse(201, newAnswer);
  } catch (err) {
    console.error('Error in createAnswer handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function createAnswer(
  dto: CreateAnswerDTO,
): Promise<AnswerItem> {
  const now = new Date().toISOString();
  const answerId = uuidv4();

  const {
    questionId,
    text,
    projectId,
    organizationId,
  } = dto;


  const sortKey = `${projectId}#${questionId}#${answerId}`;

  const answerItem: AnswerItem & DBItem = {
    [PK_NAME]: ANSWER_PK,
    [SK_NAME]: sortKey,

    id: answerId,
    questionId,
    projectId,
    organizationId,
    text,
    source: 'manual',

    createdAt: now,
    updatedAt: now,
  };

  const command = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: answerItem,
  });

  await docClient.send(command);

  return answerItem as AnswerItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:create'))
    .use(httpErrorMiddleware())
);