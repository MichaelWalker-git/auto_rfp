import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, ContentLibraryItem, createContentLibrarySK } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { docClient, getItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { PK_NAME, SK_NAME } from '@/constants/common';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Manually set lastUsedAt on a content library item.
 * Useful for testing stale content detection thresholds.
 *
 * PATCH /content-library/set-last-used/{id}?orgId=
 * Body: { lastUsedAt: "2024-01-01T00:00:00.000Z" }
 *
 * Pass a date in the past to trigger WARNING (120+ days) or STALE (180+ days).
 * Pass null to clear lastUsedAt (falls back to createdAt for staleness calculation).
 */
async function baseHandler(event: AuthedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);

    if (!itemId || !orgId) {
      return apiResponse(400, { error: 'Missing itemId or orgId' });
    }

    const body = JSON.parse(event.body || '{}');
    const { lastUsedAt } = body as { lastUsedAt: string | null };

    // Validate lastUsedAt if provided
    if (lastUsedAt !== null && lastUsedAt !== undefined) {
      const parsed = new Date(lastUsedAt);
      if (isNaN(parsed.getTime())) {
        return apiResponse(400, {
          error: 'Invalid lastUsedAt — must be an ISO 8601 datetime string or null',
          hint: 'Examples: "2024-01-01T00:00:00.000Z" (triggers STALE), "2025-01-01T00:00:00.000Z" (triggers WARNING)',
        });
      }
    }

    // Look up the item
    const sk = createContentLibrarySK(orgId, itemId);
    const item = await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);

    if (!item) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    const now = new Date().toISOString();

    // Update lastUsedAt and reset freshness so next detection run re-evaluates
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
      UpdateExpression: lastUsedAt !== null && lastUsedAt !== undefined
        ? 'SET #lastUsedAt = :lastUsedAt, #updatedAt = :now, #freshnessStatus = :active REMOVE #staleSince, #staleReason, #lastFreshnessCheck'
        : 'REMOVE #lastUsedAt SET #updatedAt = :now, #freshnessStatus = :active REMOVE #staleSince, #staleReason, #lastFreshnessCheck',
      ExpressionAttributeNames: {
        '#lastUsedAt': 'lastUsedAt',
        '#updatedAt': 'updatedAt',
        '#freshnessStatus': 'freshnessStatus',
        '#staleSince': 'staleSince',
        '#staleReason': 'staleReason',
        '#lastFreshnessCheck': 'lastFreshnessCheck',
      },
      ExpressionAttributeValues: {
        ':now': now,
        ':active': 'ACTIVE',
        ...(lastUsedAt !== null && lastUsedAt !== undefined ? { ':lastUsedAt': lastUsedAt } : {}),
      },
    }));

    const daysAgo = lastUsedAt
      ? Math.floor((Date.now() - new Date(lastUsedAt).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    return apiResponse(200, {
      message: 'lastUsedAt updated — freshness reset to ACTIVE. Run stale detection to re-evaluate.',
      itemId,
      lastUsedAt: lastUsedAt ?? null,
      daysAgo,
      hint: daysAgo !== null
        ? daysAgo >= 180
          ? '⚠️ This item will be marked STALE on next detection run'
          : daysAgo >= 120
            ? '⚠️ This item will be marked WARNING on next detection run'
            : '✅ This item will remain ACTIVE on next detection run'
        : 'lastUsedAt cleared — staleness will be calculated from createdAt',
    });
  } catch (error) {
    console.error('Error setting lastUsedAt:', error);
    return apiResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
