import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '../../sentry-lambda';
import { DeletePastProjectRequestSchema } from '@auto-rfp/core';
import { deletePastProject, getPastProject } from '@/helpers/past-performance';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error: errors } = DeletePastProjectRequestSchema.safeParse(body);
    
    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: errors.issues,
      });
    }
    
    const { orgId, projectId, hardDelete } = data;

    // Check if project exists
    const existing = await getPastProject(orgId, projectId);
    if (!existing) {
      return apiResponse(404, {
        ok: false,
        error: 'Past project not found',
      });
    }

    await deletePastProject(orgId, projectId, hardDelete);

    return apiResponse(200, {
      ok: true,
      message: hardDelete ? 'Project permanently deleted' : 'Project archived',
    });
  } catch (error: any) {
    console.error('Error deleting past project:', error);

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