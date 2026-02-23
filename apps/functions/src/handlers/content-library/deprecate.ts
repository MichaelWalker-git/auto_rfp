import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, createContentLibrarySK, } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware,   type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function baseHandler(
  event: AuthedEvent
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const kbId = event.queryStringParameters?.kbId;
    if (!itemId || !kbId || !orgId) {
      return apiResponse(400, { error: 'Missing itemId or kbId or orgId.' });
    }

    const now = nowIso();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        [PK_NAME]: CONTENT_LIBRARY_PK,
        [SK_NAME]: createContentLibrarySK(orgId, kbId, itemId),
      },
      UpdateExpression: 'SET #approvalStatus = :status, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#approvalStatus': 'approvalStatus',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'DEPRECATED',
        ':updatedAt': now,
      },
    }));

    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: event.pathParameters?.id ?? 'unknown',
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