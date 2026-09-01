import { APIGatewayProxyEventV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { listWorkflowStates } from '@/helpers/linear';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

/**
 * Lists the org's Linear team workflow states (board columns / statuses) so the
 * "Create Linear Ticket" dialog can pin the ticket's starting status. Reads the
 * team from LINEAR_TEAM_ID by default.
 */
export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }

    const states = await listWorkflowStates(orgId);

    return apiResponse(200, { states });
  } catch (error) {
    console.error('Error listing Linear workflow states', error);
    return apiResponse(500, { error: 'Failed to list Linear workflow states' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
