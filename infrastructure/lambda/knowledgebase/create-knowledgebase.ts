import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import {
  CreateKnowledgeBaseDTO,
  CreateKnowledgeBaseSchema,
  KnowledgeBase,
  KnowledgeBaseItem,
} from '../schemas/knowledge-base';
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

// --- Main Handler ---
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters || {};

  if (!orgId) {
    return apiResponse(400, { message: 'Org Id is required' });
  }

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Runtime validation using Zod
    const validationResult = CreateKnowledgeBaseSchema.safeParse(rawBody);

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

    const validatedKbData: CreateKnowledgeBaseDTO = validationResult.data;

    const newKb = await createKnowledgeBase(orgId, validatedKbData);

    return apiResponse(201, newKb);
  } catch (err) {
    console.error('Error in createKnowledgeBase handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// --- Business Logic Function ---
export async function createKnowledgeBase(
  orgId: string,
  kbData: CreateKnowledgeBaseDTO,
): Promise<KnowledgeBase> {
  const now = new Date().toISOString();
  const kbId = uuidv4();

  const knowledgeBaseItem: KnowledgeBaseItem = {
    [PK_NAME]: KNOWLEDGE_BASE_PK,
    [SK_NAME]: `${orgId}#${kbId}`,
    orgId,
    name: kbData.name,
    description: kbData.description ?? undefined,
    createdAt: now,
    updatedAt: now,
    _count: {
      questions: 0,
    },
  } as KnowledgeBaseItem;

  const command = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: knowledgeBaseItem,
  });

  await docClient.send(command);

  return {
    id: kbId,
    name: knowledgeBaseItem.name,
    description: knowledgeBaseItem.description,
    createdAt: knowledgeBaseItem.createdAt,
    updatedAt: knowledgeBaseItem.updatedAt,
    _count: knowledgeBaseItem._count,
  };
}

export const handler = withSentryLambda(baseHandler);
