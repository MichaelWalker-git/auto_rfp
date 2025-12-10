import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';

import { UpdateDocumentDTO, UpdateDocumentDTOSchema, } from '../schemas/document';
import { DOCUMENT_PK } from '../constants/document';
import { withSentryLambda } from '../sentry-lambda';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME environment variable is not set');
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is missing' });
    }

    let json: any;
    try {
      json = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    // Validate input with Zod
    const parsed = UpdateDocumentDTOSchema.safeParse(json);
    if (!parsed.success) {
      const errors = parsed.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }));
      return apiResponse(400, {
        message: 'Validation failed',
        errors,
      });
    }

    const dto: UpdateDocumentDTO = parsed.data;

    const updated = await updateDocument(dto);

    return apiResponse(200, updated);
  } catch (err) {
    console.error('Error in edit-document handler:', err);

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// -------------------------------------------------------------
// Core: Update document
// -------------------------------------------------------------
async function updateDocument(dto: UpdateDocumentDTO) {
  const now = new Date().toISOString();
  const sk = `KB#${dto.knowledgeBaseId}#DOC#${dto.id}`;

  // Build dynamic update expression
  const updates: string[] = [];
  const values: Record<string, any> = {
    ':updatedAt': now,
  };

  if (dto.name !== undefined) {
    updates.push('#name = :name');
    values[':name'] = dto.name;
  }

  if (updates.length === 0) {
    return { message: 'Nothing to update' };
  }

  updates.push('updatedAt = :updatedAt');

  const command = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: DOCUMENT_PK,
      [SK_NAME]: sk,
    },
    UpdateExpression: `SET ${updates.join(', ')}`,
    ExpressionAttributeNames: {
      '#name': 'name',
    },
    ExpressionAttributeValues: values,
    ReturnValues: 'ALL_NEW',
  });

  const res = await docClient.send(command);
  return res.Attributes;
}

export const handler = withSentryLambda(baseHandler);
