import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { PutCommand, } from '@aws-sdk/lib-dynamodb';

import { v4 as uuidv4 } from 'uuid';

import { apiResponse, getOrgId } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { DBItem, docClient } from '../helpers/db';
import { QuestionFileItem, QuestionFileItemSchema } from '@auto-rfp/shared';
import { nowIso } from '../helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'OrgId is missing' });
    }
    const body: QuestionFileItem = JSON.parse(event.body || '');
    const { success, data, error } = QuestionFileItemSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { message: error.message });
    }

    const created = await createQuestionFile(data);

    return apiResponse(201, created);
  } catch (err) {
    console.error('create-question-file error:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

async function createQuestionFile(body: QuestionFileItem) {
  const questionFileId = uuidv4();

  const {
    orgId,
    oppId,
    projectId,
    fileKey,
    originalFileName,
    mimeType,
    sourceDocumentId,
  } = body;

  const sk = `${projectId}#${questionFileId}`;

  const item: QuestionFileItem & DBItem = {
    [PK_NAME]: QUESTION_FILE_PK,
    [SK_NAME]: sk,
    orgId,
    projectId,
    oppId,
    questionFileId,
    fileKey,
    textFileKey: null,
    status: 'UPLOADED',
    originalFileName: originalFileName ?? null,
    mimeType: mimeType,
    sourceDocumentId: sourceDocumentId ?? null,

    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );

  return item;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:create'))
    .use(httpErrorMiddleware())
);
