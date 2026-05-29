import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { apiResponse } from '@/helpers/api';
import { UnlinkKBFromProjectRequestSchema } from '@auto-rfp/core';
import { unlinkKBFromProject } from '@/helpers/project-kb';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const { success, error, data } = UnlinkKBFromProjectRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!success) {
      return apiResponse(400, { message: 'Validation failed', errors: error.issues });
    }

    const { projectId, kbId } = data;

    await unlinkKBFromProject(projectId, kbId);

    return apiResponse(200, { message: 'Knowledge base unlinked from project', projectId, kbId });
  } catch (err) {
    console.error('Error unlinking KB from project:', err);
    return apiResponse(500, { message: 'Failed to unlink knowledge base from project' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(httpErrorMiddleware()),
);
