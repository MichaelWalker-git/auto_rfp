import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, ContentLibraryItem, createContentLibrarySK } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getItem, updateItem } from '@/helpers/db';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

async function baseHandler(event: AuthedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);

    if (!itemId || !orgId) {
      return apiResponse(400, { error: 'Missing itemId or orgId' });
    }

    const sk = createContentLibrarySK(orgId, itemId);
    const item = await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);

    if (!item) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    if (item.isArchived) {
      return apiResponse(400, { error: 'Cannot deprecate an archived item' });
    }

    await updateItem(CONTENT_LIBRARY_PK, sk, { approvalStatus: 'DEPRECATED' });

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: itemId,
    });

    return apiResponse(200, { message: 'Item deprecated' });
  } catch (error) {
    console.error('Error deprecating content library item:', error);
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
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
