import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  createContentLibrarySK,
  BulkReviewDTOSchema,
} from '@auto-rfp/core';
import { apiResponse, getUserId, getOrgId } from '@/helpers/api';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { PK_NAME, SK_NAME } from '@/constants/common';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function baseHandler(
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> {
  try {
    const params = event.queryStringParameters || {};
    const orgId = params.orgId || getOrgId(event);
    const kbId = params.kbId;
    const userId = getUserId(event);

    if (!orgId || !kbId) {
      return apiResponse(400, { error: 'orgId and kbId are required' });
    }

    const body = JSON.parse(event.body || '{}');
    const { success, data, error: errors } = BulkReviewDTOSchema.safeParse(body);

    if (!success) {
      return apiResponse(400, { error: 'Invalid request body', details: errors.flatten() });
    }

    const { itemIds, action } = data;
    const now = new Date().toISOString();
    const results: { itemId: string; success: boolean; error?: string }[] = [];

    for (const itemId of itemIds) {
      try {
        const sk = createContentLibrarySK(orgId, kbId, itemId);

        // Verify item exists
        const existing = await docClient.send(
          new GetCommand({
            TableName: TABLE_NAME,
            Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
          }),
        );

        if (!existing.Item) {
          results.push({ itemId, success: false, error: 'Item not found' });
          continue;
        }

        if (action === 'REACTIVATE') {
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
              UpdateExpression:
                'SET freshnessStatus = :active, staleSince = :null, staleReason = :null, reactivatedAt = :now, reactivatedBy = :userId, lastFreshnessCheck = :now, updatedAt = :now, updatedBy = :userId',
              ExpressionAttributeValues: {
                ':active': 'ACTIVE',
                ':null': null,
                ':now': now,
                ':userId': userId,
              },
            }),
          );
        } else {
          // ARCHIVE
          await docClient.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
              UpdateExpression:
                'SET freshnessStatus = :archived, isArchived = :true, archivedAt = :now, updatedAt = :now, updatedBy = :userId',
              ExpressionAttributeValues: {
                ':archived': 'ARCHIVED',
                ':true': true,
                ':now': now,
                ':userId': userId,
              },
            }),
          );
        }

        results.push({ itemId, success: true });
      } catch (err) {
        results.push({ itemId, success: false, error: String(err) });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: 'bulk-review',
    });

    return apiResponse(200, {
      message: `Bulk ${action.toLowerCase()} complete: ${succeeded} succeeded, ${failed} failed`,
      action,
      results,
    });
  } catch (error) {
    console.error('Error in bulk review:', error);
    return apiResponse(500, { error: 'Failed to process bulk review' });
  }
}

export const handler = middy(withSentryLambda(baseHandler))
  .use(auditMiddleware())
    .use(httpErrorMiddleware())
  .use(authContextMiddleware())
  .use(orgMembershipMiddleware());
