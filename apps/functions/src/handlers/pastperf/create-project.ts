import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { CreatePastProjectDTOSchema } from '@auto-rfp/core';
import { createPastProject } from '@/helpers/past-performance';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { success, data, error: errors } = CreatePastProjectDTOSchema.safeParse(body);
    
    if (!success) {
      return apiResponse(400, {
        ok: false,
        error: 'Validation error',
        details: errors.issues,
      });
    }
    
    const dto = data;
    const userId = event.auth?.userId || 'system';

    const project = await createPastProject(dto, userId);

    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'pastperf-project',
    });

    return apiResponse(201, {
      ok: true,
      project,
    });
  } catch (error: any) {
    console.error('Error creating past project:', error);

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
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);