import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';

import { PK_NAME, SK_NAME } from '../constants/common';
import { apiResponse } from '../helpers/api';
import { CreateDocumentDTO, CreateDocumentDTOSchema, DocumentItem, } from '../schemas/document';
import { v4 as uuidv4 } from 'uuid';
import { DOCUMENT_PK } from '../constants/document';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENT_INDEXER_FUNCTION_NAME = process.env.DOCUMENT_INDEXER_FUNCTION_NAME;

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
    const validationResult = CreateDocumentDTOSchema.safeParse(rawBody);

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

    const dto: CreateDocumentDTO = validationResult.data;

    // 2. Create document item in Dynamo
    const newDocument = await createDocument(dto);

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
): Promise<DocumentItem> {
  const now = new Date().toISOString();
  const docId = uuidv4();

  const { knowledgeBaseId, name, fileKey, textFileKey } = dto;

  const documentItem: DocumentItem = {
    [PK_NAME]: DOCUMENT_PK,
    [SK_NAME]: `KB#${knowledgeBaseId}#DOC#${docId}`,
    id: docId,
    knowledgeBaseId,
    name,
    fileKey,
    textFileKey,
    indexStatus: 'pending', // indexing pipeline will update this
    createdAt: now,
    updatedAt: now,
    // indexVectorKey is optional, omitted here
  };

  const command = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: documentItem,
  });

  await docClient.send(command);

  return documentItem;
}
