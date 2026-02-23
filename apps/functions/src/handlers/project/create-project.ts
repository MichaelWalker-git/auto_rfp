import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { CreateProjectSchema } from '@auto-rfp/core';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { createProject } from '@/helpers/project';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);

    const { success, data, error: errors } = CreateProjectSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = errors.issues.map((issue: { path: (string | number)[]; message: string }) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const project = await createProject(data);

    setAuditContext(event, {
      action: 'PROJECT_CREATED',
      resource: 'project',
      resourceId: project.id,
      orgId: data.orgId,
      changes: { after: project },
    });

    return apiResponse(201, project);
  } catch (err) {
    console.error('Error in createProject handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
