import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, } from '@aws-sdk/lib-dynamodb';

import { v4 as uuidv4 } from 'uuid';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;

if (!DB_TABLE_NAME) {
  throw new Error('DB_TABLE_NAME env var is not set');
}

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// --------- DTO types (simple, no Zod here) ---------

interface CreateQuestionFileBody {
  projectId: string;
  fileKey: string;              // S3 key of uploaded file
  originalFileName?: string;    // optional: shown in UI
  mimeType?: string;            // optional: pdf/docx/etc
  sourceDocumentId?: string;    // optional: id of document this file belongs to
}

// --------- Handler ---------

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is missing' });
    }

    let body: CreateQuestionFileBody;
    try {
      body = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON body' });
    }

    const validationError = validateBody(body);
    if (validationError) {
      return apiResponse(400, { message: validationError });
    }

    const created = await createQuestionFile(body);

    return apiResponse(201, created);
  } catch (err) {
    console.error('create-question-file error:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

// --------- Validation ---------

function validateBody(body: Partial<CreateQuestionFileBody>): string | null {
  if (!body.projectId || typeof body.projectId !== 'string') {
    return 'projectId is required and must be a string';
  }
  if (!body.fileKey || typeof body.fileKey !== 'string') {
    return 'fileKey is required and must be a string';
  }
  return null;
}

// --------- Core Logic ---------

async function createQuestionFile(body: CreateQuestionFileBody) {
  const now = new Date().toISOString();
  const questionFileId = uuidv4();

  const {
    projectId,
    fileKey,
    originalFileName,
    mimeType,
    sourceDocumentId,
  } = body;

  // SK pattern is already used elsewhere:
  //   SK = `${projectId}#${questionFileId}`
  const sk = `${projectId}#${questionFileId}`;

  const item: Record<string, any> = {
    [PK_NAME]: QUESTION_FILE_PK,
    [SK_NAME]: sk,

    questionFileId,
    projectId,
    fileKey,
    textFileKey: null,          // will be filled after Textract
    status: 'uploaded',         // pipeline will move it to processing/text_ready/...
    originalFileName: originalFileName ?? null,
    mimeType: mimeType ?? null,
    sourceDocumentId: sourceDocumentId ?? null, // <-- “file id questions were extracted from”

    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );

  return item;
}
