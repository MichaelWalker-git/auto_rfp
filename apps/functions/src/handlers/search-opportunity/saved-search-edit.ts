/**
 * Unified edit-saved-search handler.
 * PATCH /search-opportunities/saved-search/{id}?orgId=...
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
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { PatchSchema } from '@auto-rfp/core';
import { updateItem } from '@/helpers/db';
import { SAVED_SEARCH_PK } from '@/constants/samgov';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const savedSearchId = event.pathParameters?.id;
  if (!savedSearchId) return apiResponse(400, { message: 'savedSearchId path param is required' });

  const orgId = event.queryStringParameters?.orgId ?? event.auth?.orgId;
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  if (!event.body) return apiResponse(400, { message: 'Request body is required' });
  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = PatchSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const sk = `${orgId}#${savedSearchId}`;
  const updated = await updateItem(SAVED_SEARCH_PK, sk, data);

  setAuditContext(event, { action: 'CONFIG_CHANGED', resource: 'config', resourceId: savedSearchId });
  return apiResponse(200, updated);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
