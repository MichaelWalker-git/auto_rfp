import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '../constants/common';

import { type ExecutiveBriefItem, ExecutiveBriefItemSchema, } from '@auto-rfp/shared';

import { getExecutiveBrief } from '../helpers/executive-opportunity-frief';
import { PROJECT_PK } from '../constants/organization';
import { getProjectById } from '../helpers/project';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const RequestSchema = z.object({
  projectId: z.string().min(1),
});

const ProjectWithBriefLinkSchema = z.object({
  executiveBriefId: z.string().min(1).optional(),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    // Support either JSON body or path param
    const bodyJson = event.body ? JSON.parse(event.body) : {};
    const projectId =
      event.pathParameters?.projectId ??
      RequestSchema.parse(bodyJson).projectId;

    // 1) Load project to get executiveBriefId
    const projRes = await getProjectById(docClient, DB_TABLE_NAME, projectId);

    const projectParsed = ProjectWithBriefLinkSchema.safeParse(projRes);
    if (!projectParsed.success) {
      return apiResponse(500, {
        ok: false,
        error: 'Project item missing/invalid executiveBriefId field',
      });
    }

    const executiveBriefId = projectParsed.data.executiveBriefId;
    if (!executiveBriefId) {
      return apiResponse(404, {
        ok: false,
        error: `No executive brief linked for projectId=${projectId}`,
      });
    }

    // 2) Load executive brief entity
    const brief: ExecutiveBriefItem = await getExecutiveBrief(executiveBriefId);
    ExecutiveBriefItemSchema.parse(brief);

    return apiResponse(200, {
      ok: true,
      projectId,
      executiveBriefId,
      brief,
    });
  } catch (err) {
    console.error('get-executive-brief-by-project error:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
