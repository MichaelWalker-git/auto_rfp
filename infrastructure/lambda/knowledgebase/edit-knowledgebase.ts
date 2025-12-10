import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import { KnowledgeBaseItem, UpdateKnowledgeBaseDTO, UpdateKnowledgeBaseSchema, } from '../schemas/knowledge-base';
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
  const { orgId, kbId } = event.pathParameters || {};

  if (!orgId || !kbId) {
    return apiResponse(400, {
      message: 'Missing required path parameters: orgId and kbId',
    });
  }

  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Validate body with Zod
    const validationResult = UpdateKnowledgeBaseSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map((issue: any) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const validatedData: UpdateKnowledgeBaseDTO = validationResult.data;

    const updatedKb = await updateKnowledgeBase(orgId, kbId, validatedData);

    return apiResponse(200, updatedKb);
  } catch (err) {
    console.error('Error in updateKnowledgeBase handler:', err);

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
export async function updateKnowledgeBase(
  orgId: string,
  kbId: string,
  data: UpdateKnowledgeBaseDTO,
) {
  const now = new Date().toISOString();
  const sk = `${orgId}#${kbId}`;

  // Build dynamic UpdateExpression
  let updateExpression = 'SET #updatedAt = :updatedAt';
  const expressionAttributeNames: Record<string, string> = {
    '#updatedAt': 'updatedAt',
    '#pk': PK_NAME,
  };
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
  };

  if (typeof data.name === 'string') {
    updateExpression += ', #name = :name';
    expressionAttributeNames['#name'] = 'name';
    expressionAttributeValues[':name'] = data.name;
  }

  if (data.description !== undefined) {
    updateExpression += ', #description = :description';
    expressionAttributeNames['#description'] = 'description';
    expressionAttributeValues[':description'] = data.description;
  }

  const command = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: KNOWLEDGE_BASE_PK,
      [SK_NAME]: sk,
    },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ConditionExpression: 'attribute_exists(#pk)', // 404 if not found
    ReturnValues: 'ALL_NEW',
  });

  try {
    const result = await docClient.send(command);

    if (!result.Attributes) {
      throw new Error('Update succeeded but no attributes returned');
    }

    const item = result.Attributes as KnowledgeBaseItem;

    // Map DB item -> API shape
    return {
      id: kbId,
      name: item.name,
      description: item.description,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      _count: item._count ?? { questions: 0 },
    };
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      // Not found
      throw new Error('Knowledge base not found');
    }

    throw err;
  }
}

export const handler = withSentryLambda(baseHandler);
