import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getUserId } from '@/helpers/api';
import { upsertAgencyContact } from '@/helpers/foia-agency-contact';
import { FoiaAgencyContactCreateRequestSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const userId = getUserId(event) ?? 'system';

  const { success, data, error } = FoiaAgencyContactCreateRequestSchema.safeParse(
    JSON.parse(event.body ?? '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { orgId } = data;
  const contact = await upsertAgencyContact(orgId, data, userId);

  return apiResponse(200, { contact });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(httpErrorMiddleware()),
);
