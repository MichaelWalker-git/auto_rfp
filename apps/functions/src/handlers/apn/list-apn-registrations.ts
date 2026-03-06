import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { queryBySkPrefix } from '@/helpers/db';
import { APN_REGISTRATION_PK } from '@/constants/apn';
import type { ApnRegistrationItem } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.queryStringParameters ?? {};

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  // Query all registrations for this org using orgId as SK prefix
  const items = await queryBySkPrefix<ApnRegistrationItem>(
    APN_REGISTRATION_PK,
    orgId,
  );

  // Sort by most recently created first
  const sorted = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return apiResponse(200, { items: sorted, count: sorted.length });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
