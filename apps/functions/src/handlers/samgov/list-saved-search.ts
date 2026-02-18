import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { type SavedSearch, SavedSearchSchema } from '@auto-rfp/core';
import { SAVED_SEARCH_PK } from '@/constants/samgov';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

function parseLimit(v: unknown, fallback = 50) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

function decodeNextToken(token?: string): Record<string, any> | undefined {
  if (!token) return undefined;
  try {
    const json = Buffer.from(token, 'base64').toString('utf-8');
    const key = JSON.parse(json);
    return typeof key === 'object' && key ? key : undefined;
  } catch {
    return undefined;
  }
}

function encodeNextToken(lastKey?: Record<string, any> | null): string | null {
  if (!lastKey) return null;
  return Buffer.from(JSON.stringify(lastKey), 'utf-8').toString('base64');
}

// ---------------- handler ----------------
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const qs = event.queryStringParameters ?? {};

    const orgIdFromAuth = (event as any)?.auth?.orgId as string | undefined;
    const orgId = (qs.orgId || orgIdFromAuth || '').trim();
    if (!orgId) return apiResponse(400, { message: 'orgId is required' });

    // prevent listing other orgs
    if (orgIdFromAuth && qs.orgId && qs.orgId !== orgIdFromAuth) {
      return apiResponse(403, { message: 'orgId mismatch' });
    }

    const limit = parseLimit(qs.limit, 50);
    const nextToken = qs.nextToken;
    const ExclusiveStartKey = decodeNextToken(nextToken);

    const pk = SAVED_SEARCH_PK;
    const skPrefix = `${orgId}#`;

    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': skPrefix,
        },
        Limit: limit,
        ExclusiveStartKey,
        // optional: sort newest first by SK if you ever embed timestamps; otherwise keep default
        // ScanIndexForward: false,
      }),
    );

    const rawItems = (res.Items ?? []) as any[];

    // Validate/shape items. If something is malformed, we skip it instead of failing the whole list.
    const items: SavedSearch[] = [];
    for (const it of rawItems) {
      const parsed = SavedSearchSchema.safeParse(it);
      if (parsed.success) items.push(parsed.data);
    }

    return apiResponse(200, {
      items,
      nextToken: encodeNextToken(res.LastEvaluatedKey ?? null),
      count: items.length,
    });
  } catch (err: any) {
    console.error('Error in list-saved-searches:', err);
    return apiResponse(500, {
      message: 'Failed to list saved searches',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
