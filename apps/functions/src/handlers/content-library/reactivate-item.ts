import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  ContentLibraryItem,
  createContentLibrarySK,
  ReactivateContentItemDTOSchema,
} from '@auto-rfp/core';
import { apiResponse, getUserId, getOrgId } from '@/helpers/api';
import { getItem, updateItem } from '@/helpers/db';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { nowIso } from '@/helpers/date';

async function baseHandler(event: AuthedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const userId = getUserId(event);

    if (!itemId || !orgId) {
      return apiResponse(400, { error: 'itemId and orgId are required' });
    }

    const { success, data, error: errors } = ReactivateContentItemDTOSchema.safeParse(
      JSON.parse(event.body || '{}'),
    );

    if (!success) {
      return apiResponse(400, { error: 'Invalid request body', details: errors.flatten() });
    }

    const sk = createContentLibrarySK(orgId, itemId);
    const existing = await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);

    if (!existing) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    const now = nowIso();

    const updates: Partial<ContentLibraryItem> & Record<string, unknown> = {
      freshnessStatus: 'ACTIVE',
      staleSince: null,
      staleReason: null,
      reactivatedAt: now,
      reactivatedBy: userId,
      lastFreshnessCheck: now,
      updatedBy: userId,
    };

    if (data.certExpiryDate !== undefined) {
      updates.certExpiryDate = data.certExpiryDate;
    }

    await updateItem(CONTENT_LIBRARY_PK, sk, updates);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: itemId,
    });

    return apiResponse(200, {
      message: 'Content item reactivated successfully',
      itemId,
      freshnessStatus: 'ACTIVE',
    });
  } catch (error) {
    console.error('Error reactivating content item:', error);
    return apiResponse(500, { error: 'Failed to reactivate content item' });
  }
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
