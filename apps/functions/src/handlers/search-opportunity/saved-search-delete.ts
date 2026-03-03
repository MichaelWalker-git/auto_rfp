/**
 * Unified delete-saved-search handler.
 * DELETE /search-opportunities/saved-search/{id}?orgId=...
 *
 * All saved searches live in a single DynamoDB entity (SAVED_SEARCH_PK).
 * The source query param is no longer needed — all searches use the same table.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { deleteItem } from '@/helpers/db';
import { SAVED_SEARCH_PK } from '@/constants/samgov';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const savedSearchId = event.pathParameters?.id;
  if (!savedSearchId) return apiResponse(400, { message: 'savedSearchId path param is required' });

  const orgId = event.queryStringParameters?.orgId ?? event.auth?.orgId;
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  await deleteItem(SAVED_SEARCH_PK, `${orgId}#${savedSearchId}`);

  return apiResponse(200, { ok: true, savedSearchId });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:delete'))
    .use(httpErrorMiddleware()),
);
