import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  ContentLibraryItem,
  createContentLibrarySK,
  BulkApproveDTOSchema,
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

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const userId = getUserId(event);

    if (!orgId) {
      return apiResponse(400, { error: 'orgId is required' });
    }

    const { success, data, error: errors } = BulkApproveDTOSchema.safeParse(
      JSON.parse(event.body || '{}'),
    );

    if (!success) {
      return apiResponse(400, { error: 'Invalid request body', details: errors.flatten() });
    }

    const { itemIds } = data;
    const now = nowIso();
    const results: Array<{ itemId: string; success: boolean; error?: string }> = [];

    for (const itemId of itemIds) {
      try {
        const sk = createContentLibrarySK(orgId, itemId);
        const existing = await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);

        if (!existing) {
          results.push({ itemId, success: false, error: 'Item not found' });
          continue;
        }

        if (existing.isArchived) {
          results.push({ itemId, success: false, error: 'Cannot approve an archived item' });
          continue;
        }

        if (existing.approvalStatus === 'APPROVED') {
          // Already approved — count as success but skip the write
          results.push({ itemId, success: true });
          continue;
        }

        await updateItem(CONTENT_LIBRARY_PK, sk, {
          approvalStatus: 'APPROVED',
          approvedBy: userId,
          approvedAt: now,
          updatedAt: now,
          updatedBy: userId,
        });

        results.push({ itemId, success: true });
      } catch (err) {
        results.push({
          itemId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: 'bulk-approve',
    });

    return apiResponse(200, {
      message: `Bulk approve complete: ${succeeded} approved, ${failed} failed`,
      results,
    });
  } catch (error) {
    console.error('Error in bulk approve:', error);
    return apiResponse(500, { error: 'Failed to process bulk approve' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
