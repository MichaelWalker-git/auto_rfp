import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { UpdatePastProjectDTOSchema } from '@auto-rfp/core';
import { updatePastProject } from '@/helpers/past-performance';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const UpdateRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  updates: UpdatePastProjectDTOSchema,
});

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error: errors } = UpdateRequestSchema.safeParse(body);
    
    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: errors.issues,
      });
    }
    
    const { orgId, projectId, updates } = data;

    const project = await updatePastProject(orgId, projectId, updates);

    if (!project) {
      return apiResponse(404, {
        ok: false,
        error: 'Past project not found',
      });
    }

    return apiResponse(200, {
      ok: true,
      project,
    });
  } catch (error: any) {
    console.error('Error updating past project:', error);

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