import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { AnswerItem, CreateAnswerDTO, CreateAnswerDTOSchema, } from '../schemas/answer';
import { ANSWER_PK } from '../constants/answer';
import { withSentryLambda } from '../sentry-lambda';

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

export const baseHandler = async (
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

    // 2. Create answer item in Dynamo
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

// --- Business Logic ---
// Input is guaranteed valid CreateAnswerDTO thanks to Zod

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

  const answerItem: AnswerItem & Record<string, any> = {
    [PK_NAME]: ANSWER_PK,
    [SK_NAME]: sortKey,

    id: answerId,
    questionId,
    projectId,
    organizationId,
    text,
    source: 'manual',   // we know this is user-entered

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

export const handler = withSentryLambda(baseHandler);