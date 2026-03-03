import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, createContentLibrarySK } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { deleteItem, getItem, updateItem } from '@/helpers/db';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { nowIso } from '@/helpers/date';
import { deleteVectorById } from '@/helpers/pinecone';

/**
 * Delete (archive) a content library item
 * DELETE /content-library/delete-content-library/{id}?orgId={orgId}&hardDelete={true}
 */
async function baseHandler(event: AuthedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const kbId = event.queryStringParameters?.kbId;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const hardDelete = event.queryStringParameters?.hardDelete === 'true';

    if (!itemId || !orgId) {
      return apiResponse(400, { error: 'Missing required parameter (itemId, orgId)' });
    }

    // Try new SK format first (orgId#itemId), fall back to legacy (orgId#kbId#itemId)
    let sk = createContentLibrarySK(orgId, itemId);
    const existing = await getItem(CONTENT_LIBRARY_PK, sk);
    if (!existing && kbId) {
      sk = createContentLibrarySK(orgId, kbId, itemId);
    }

    if (hardDelete) {
      await deleteItem(CONTENT_LIBRARY_PK, sk);
      await deleteVectorById(orgId, itemId);

      setAuditContext(event, {
        action: 'CONFIG_CHANGED',
        resource: 'knowledge_base',
        resourceId: itemId,
      });

      return apiResponse(200, { message: 'Item permanently deleted' });
    }

    const now = nowIso();
    await updateItem(CONTENT_LIBRARY_PK, sk, {
      isArchived: true,
      archivedAt: now,
    });
    await deleteVectorById(orgId, itemId);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: itemId,
    });

    return apiResponse(200, { message: 'Item archived' });
  } catch (error) {
    console.error('Error deleting content library item:', error);
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
