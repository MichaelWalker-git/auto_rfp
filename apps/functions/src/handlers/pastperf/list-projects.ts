import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '../../sentry-lambda';
import { ListPastProjectsRequestSchema } from '@auto-rfp/core';
import { listPastProjects } from '@/helpers/past-performance';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error: errors } = ListPastProjectsRequestSchema.safeParse(body);
    
    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: errors.issues,
      });
    }
    
    const { orgId, includeArchived, limit, nextToken } = data;

    const result = await listPastProjects(orgId, includeArchived, limit, nextToken);

    return apiResponse(200, {
      ok: true,
      ...result,
    });
  } catch (error: any) {
    console.error('Error listing past projects:', error);

    if (error.name === 'ZodError') {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: error.errors,
      });
    }

    return apiResponse(500, {
      ok: false,
      error: error.message || 'Internal server error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware())
);