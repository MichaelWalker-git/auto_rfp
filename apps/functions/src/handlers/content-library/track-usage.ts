import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, ContentLibraryItem, TrackUsageDTOSchema, createContentLibrarySK } from '@auto-rfp/core';
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
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { nowIso } from '@/helpers/date';
import { PK_NAME, SK_NAME } from '@/constants/common';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function baseHandler(event: AuthedEvent): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);

    if (!itemId || !orgId) {
      return apiResponse(400, { error: 'Missing itemId or orgId' });
    }

    const { success, data, error: errors } = TrackUsageDTOSchema.safeParse(
      JSON.parse(event.body || '{}'),
    );

    if (!success) {
      return apiResponse(400, { error: 'Invalid request body', details: errors.flatten() });
    }

    const { projectId } = data;
    const sk = createContentLibrarySK(orgId, itemId);
    const now = nowIso();

    // Verify item exists
    const existing = await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);
    if (!existing) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    const key = { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk };

    // Increment usage count and update lastUsedAt
    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: 'SET #usageCount = if_not_exists(#usageCount, :zero) + :inc, #lastUsedAt = :now',
      ExpressionAttributeNames: {
        '#usageCount': 'usageCount',
        '#lastUsedAt': 'lastUsedAt',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
        ':now': now,
        ':zero': 0,
      },
    }));

    // Add projectId to usedInProjectIds if not already present
    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: 'SET #usedInProjectIds = list_append(if_not_exists(#usedInProjectIds, :emptyList), :projectId)',
        ConditionExpression: 'attribute_not_exists(#usedInProjectIds) OR NOT contains(#usedInProjectIds, :projectIdStr)',
        ExpressionAttributeNames: {
          '#usedInProjectIds': 'usedInProjectIds',
        },
        ExpressionAttributeValues: {
          ':projectId': [projectId],
          ':projectIdStr': projectId,
          ':emptyList': [],
        },
      }));
    } catch (conditionalError: unknown) {
      // Ignore ConditionalCheckFailedException — projectId already in list
      if (
        !(conditionalError instanceof Error) ||
        !conditionalError.name.includes('ConditionalCheckFailed')
      ) {
        throw conditionalError;
      }
    }

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: itemId,
    });

    return apiResponse(200, { message: 'Usage tracked' });
  } catch (error) {
    console.error('Error tracking content library usage:', error);
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
