import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { AnswerItem, CreateAnswerDTO, CreateAnswerDTOSchema, } from '../schemas/answer';
import { ANSWER_PK } from '../constants/answer';

// --- Dynamo client setup ---
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Runtime validation with Zod
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

    // 2. Upsert answer item in Dynamo
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

// --- Business Logic ---
// Upsert answer by (projectId, questionId)

export async function saveAnswer(
  dto: CreateAnswerDTO,
): Promise<AnswerItem> {
  const now = new Date().toISOString();
  const { questionId, text, projectId, organizationId } = dto;

  // We treat "one answer per (projectId, questionId)" as upsert target.
  // SK pattern when creating: `${projectId}#${questionId}#${answerId}`
  const skPrefix = `${projectId}#${questionId}#`;

  // 1) Try to find existing answer for this (projectId, questionId)
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
      Limit: 1, // we only care about first match
    }),
  );

  const existing = (queryRes.Items?.[0] as
    | (AnswerItem & Record<string, any>)
    | undefined) ?? undefined;

  if (existing) {
    // 2) UPDATE existing answer
    const key = {
      [PK_NAME]: existing[PK_NAME],
      [SK_NAME]: existing[SK_NAME],
    };

    const updateRes = await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
        UpdateExpression:
          'SET #text = :text, #organizationId = :organizationId, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#text': 'text',
          '#organizationId': 'organizationId',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':text': text,
          ':organizationId': organizationId ?? null,
          ':updatedAt': now,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );

    return updateRes.Attributes as AnswerItem;
  }

  // 3) CREATE new answer if none exists
  const answerId = uuidv4();
  const sortKey = `${projectId}#${questionId}#${answerId}`;

  const answerItem: AnswerItem & Record<string, any> = {
    [PK_NAME]: ANSWER_PK,
    [SK_NAME]: sortKey,

    id: answerId,
    questionId,
    projectId,
    organizationId,
    text,
    source: 'manual', // still a manual answer

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
