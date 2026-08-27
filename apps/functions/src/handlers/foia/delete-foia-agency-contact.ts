import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { deleteAgencyContact } from '@/helpers/foia-agency-contact';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, agencyKey } = event.queryStringParameters ?? {};

  if (!orgId || !agencyKey) {
    return apiResponse(400, { message: 'Missing required query parameters: orgId and agencyKey' });
  }

  await deleteAgencyContact(orgId, agencyKey);

  return apiResponse(200, { message: 'Agency contact deleted', agencyKey });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(httpErrorMiddleware()),
);
