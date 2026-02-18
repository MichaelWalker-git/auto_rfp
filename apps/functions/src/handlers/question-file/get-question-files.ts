import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { listQuestionFilesByOpportunity, listQuestionFilesByProject } from '@/helpers/questionFile';

const safeJsonParse = <T, >(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId, oppId, limit: queryLimit, nextToken } = event.queryStringParameters ?? {};

    if (!projectId) return apiResponse(400, { message: 'projectId is required' });

    const limitRaw = queryLimit ? Number(queryLimit) : undefined;
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(200, Math.floor(limitRaw)))
        : undefined;

    const decodedNextToken = nextToken ? decodeURIComponent(nextToken) : undefined;
    const exclusiveStartKey = decodedNextToken ? safeJsonParse<Record<string, any>>(decodedNextToken) : undefined;

    if (decodedNextToken && !exclusiveStartKey) {
      return apiResponse(400, { message: 'Invalid nextToken' });
    }

    const res = oppId
      ? await listQuestionFilesByOpportunity({
        projectId,
        oppId,
        limit,
        nextToken: exclusiveStartKey,
      })
      : await listQuestionFilesByProject({
        projectId,
        limit,
        nextToken: exclusiveStartKey,
      });

    return apiResponse(200, {
      items: res.items,
      nextToken: res.nextToken ? JSON.stringify(res.nextToken) : null,
    });
  } catch (err) {
    console.error('get-question-files error:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read')),
);