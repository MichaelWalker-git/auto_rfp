import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { MatchProjectsRequestSchema } from '@auto-rfp/core';
import {
  PastPerformanceMatchingError,
  runPastPerformanceMatching,
} from '@/helpers/past-performance-matching';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const body = JSON.parse(event.body || '{}');

  const { success, data, error } = MatchProjectsRequestSchema.safeParse(body);
  if (!success) {
    return apiResponse(400, {
      ok: false,
      error: 'Validation error',
      details: error.issues,
    });
  }

  const { executiveBriefId, topK, force } = data;

  try {
    const { pastPerformance, cached } = await runPastPerformanceMatching({
      executiveBriefId,
      topK,
      force,
    });

    return apiResponse(200, {
      ok: true,
      ...(cached ? { cached: true } : {}),
      pastPerformance,
    });
  } catch (err) {
    if (err instanceof PastPerformanceMatchingError) {
      return apiResponse(err.statusCode, { ok: false, error: err.message });
    }

    console.error('Error matching past projects:', err);
    return apiResponse(500, {
      ok: false,
      error: err instanceof Error ? err.message : 'Internal server error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware())
);
