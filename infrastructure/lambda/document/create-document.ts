import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse, getUserId } from '../helpers/api';
import { CreateDocumentDTO, CreateDocumentDTOSchema, DocumentItem, } from '../schemas/document';
import { v4 as uuidv4 } from 'uuid';
import { DOCUMENT_PK } from '../constants/document';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { nowIso } from '../helpers/date';
import { buildDocumentSK } from '../helpers/document';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    // 1. Runtime validation with Zod
    const { success, data, error } = CreateDocumentDTOSchema.safeParse(rawBody);

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

    // 2. Create document item in Dynamo
    const userId = getUserId(event) ?? 'system';
    const newDocument = await createDocument(data, userId);

    return apiResponse(201, newDocument);
  } catch (err) {
    console.error('Error in createDocument handler:', err);

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
// Input is guaranteed valid CreateDocumentDTO thanks to Zod
export async function createDocument(
  dto: CreateDocumentDTO,
  userId: string = 'system',
): Promise<DocumentItem> {
  const now =  nowIso()
  const docId = uuidv4();

  const { knowledgeBaseId, name, fileKey, textFileKey } = dto;

  const documentItem: DocumentItem = {
    [PK_NAME]: DOCUMENT_PK,
    [SK_NAME]: buildDocumentSK(knowledgeBaseId, docId),
    id: docId,
    knowledgeBaseId,
    name,
    fileKey,
    textFileKey,
    indexStatus: 'pending', // indexing pipeline will update this
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
    // indexVectorKey is optional, omitted here
  };

  const command = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: documentItem,
  });

  await docClient.send(command);

  return documentItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:create'))
    .use(httpErrorMiddleware())
);