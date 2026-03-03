/**
 * Unified list-saved-search handler.
 * GET /search-opportunities/saved-search?orgId=...&source=SAM_GOV|DIBBS|ALL
 *
 * All saved searches live in a single DynamoDB entity (SAVED_SEARCH_PK).
 * The `source` field on each item is used to filter by integration.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
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
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { SAVED_SEARCH_PK } from '@/constants/samgov';
import { requireEnv } from '@/helpers/env';
import { SavedSearchSchema } from '@auto-rfp/core';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const qs = event.queryStringParameters ?? {};
  const orgId = qs.orgId ?? (event as AuthedEvent).auth?.orgId;
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const sourceFilter = (qs.source ?? 'ALL').toUpperCase();

  const res = await docClient.send(new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
    ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
    ExpressionAttributeValues: { ':pk': SAVED_SEARCH_PK, ':prefix': `${orgId}#` },
  }));

  const items: unknown[] = [];
  for (const it of res.Items ?? []) {
    const { success, data } = SavedSearchSchema.safeParse(it);
    if (!success) continue;
    // Filter by source if requested
    if (sourceFilter !== 'ALL' && data.source !== sourceFilter) continue;
    items.push(data);
  }

  return apiResponse(200, { items, count: items.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
