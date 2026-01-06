import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { type ExecutiveBriefItem, ExecutiveBriefItemSchema, } from '@auto-rfp/shared';

import { executiveBriefSK, loadLatestQuestionFile, putExecutiveBrief, } from '../helpers/executive-opportunity-brief';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';
import { getProjectById } from '../helpers/project';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { nowIso } from '../helpers/date';


const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const RequestSchema = z.object({
  projectId: z.string().min(1),
});


function buildEmptySection() {
  const now = nowIso();
  return { status: 'IDLE' as const, updatedAt: now };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const { projectId } = RequestSchema.parse(bodyJson);

    const qf = await loadLatestQuestionFile(projectId);

    const id = uuidv4()
    const sk = executiveBriefSK(projectId, id);
    const now = nowIso();

    const brief: ExecutiveBriefItem = {
      [PK_NAME]: EXEC_BRIEF_PK,
      [SK_NAME]: sk,
      projectId,
      questionFileId: qf.questionFileId,
      textKey: qf.textFileKey,
      documentsBucket: DOCUMENTS_BUCKET,
      status: 'IDLE',
      sections: {
        summary: buildEmptySection(),
        deadlines: buildEmptySection(),
        requirements: buildEmptySection(),
        contacts: buildEmptySection(),
        risks: buildEmptySection(),
        scoring: buildEmptySection(),
      },

      createdAt: now,
      updatedAt: now,
    } as any;

    ExecutiveBriefItemSchema.parse(brief);

    await putExecutiveBrief(brief);

    const project = await getProjectById(projectId);
    if (!project) {
      return apiResponse(400, `Project ${projectId} not found`);
    }

    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: project[PK_NAME],
          [SK_NAME]: project[SK_NAME],
        },
        UpdateExpression:
          'SET executiveBriefId = :sk, executiveBriefStatus = :st, executiveBriefUpdatedAt = :now',
        ExpressionAttributeValues: {
          ':sk': sk,
          ':st': 'IDLE',
          ':now': now,
        },
      }),
    );

    return apiResponse(200, {
      ok: true,
      projectId,
      executiveBriefId: sk,
      questionFileId: brief.questionFileId,
      textKey: brief.textKey,
    });
  } catch (err) {
    console.error('init-executive-brief error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('brief:create'))
    .use(httpErrorMiddleware())
);
