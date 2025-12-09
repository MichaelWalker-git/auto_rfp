import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, } from '@aws-sdk/lib-dynamodb';

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

type QuestionFileStatus =
  | 'processing'
  | 'text_ready'
  | 'questions_extracted'
  | 'error';

interface QuestionFileItem {
  id: string;
  projectId: string;
  fileKey: string;
  textFileKey?: string;
  status: QuestionFileStatus;
  createdAt: string;
  updatedAt: string;
}

export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const qs = event.queryStringParameters || {};
    const projectId = qs.projectId;
    const questionFileId = qs.id || qs.questionFileId;

    if (!projectId || !questionFileId) {
      return apiResponse(400, {
        message: 'projectId and id (questionFileId) are required query parameters',
      });
    }

    const item = await getQuestionFile(projectId, questionFileId);

    if (!item) {
      return apiResponse(404, {
        message: 'Question file not found',
        projectId,
        questionFileId,
      });
    }

    return apiResponse(200, {
      questionFileId: item.id,
      projectId: item.projectId,
      status: item.status,
      fileKey: item.fileKey,
      textFileKey: item.textFileKey,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  } catch (err) {
    console.error('get-question-file error:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

async function getQuestionFile(
  projectId: string,
  questionFileId: string,
): Promise<QuestionFileItem | null> {
  const sk = `${projectId}#${questionFileId}`;

  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
    }),
  );

  if (!res.Item) {
    return null;
  }

  const item = res.Item as QuestionFileItem & {
    [PK_NAME]: string;
    [SK_NAME]: string;
  };

  // If you didn’t store `id`/`projectId` explicitly, derive them from SK:
  if (!item.id) {
    item.id = questionFileId;
  }
  if (!item.projectId) {
    item.projectId = projectId;
  }

  return item;
}
