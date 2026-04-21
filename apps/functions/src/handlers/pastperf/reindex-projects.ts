import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { withSentryLambda } from '@/sentry-lambda';
import { reindexAllPastProjects } from '@/helpers/past-performance';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const ReindexRequestSchema = z.object({
  orgId: z.string().uuid(),
});

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const body = JSON.parse(event.body || '{}');
  const { success, data, error } = ReindexRequestSchema.safeParse(body);

  if (!success) {
    return apiResponse(400, {
      ok: false,
      error: 'Validation error',
      details: error.issues,
    });
  }

  const result = await reindexAllPastProjects(data.orgId);

  return apiResponse(200, {
    ok: true,
    ...result,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware())
);
