import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';

import { GetCommand, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';
import middy from '@middy/core'
import { requireEnv } from '../helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import { docClient } from '../helpers/db';
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

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

export const baseHandler = async (
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

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(httpErrorMiddleware())
);
