import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  ContentLibraryItem,
  CreateContentLibraryItemDTOSchema,
  createContentLibrarySK,
} from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { withSentryLambda } from '../sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '../middleware/rbac-middleware';
import { nowIso } from '../helpers/date';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Create a new content library item
 * POST /api/content-library/items
 */
async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const body = JSON.parse(event.body || '');

    const { success, data, error } = CreateContentLibraryItemDTOSchema.safeParse(body);
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: error.format() });
    }

    const orgId = data.orgId || getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { error: 'Missing orgId' });
    }

    const userId = (event.requestContext as any)?.authorizer?.claims?.sub || 'system';
    const itemId = uuidv4();
    const now = nowIso();

    const item: ContentLibraryItem = {
      id: itemId,
      orgId,
      kbId: data.kbId,
      question: data.question,
      answer: data.answer,
      category: data.category,
      tags: data.tags || [],
      description: data.description,
      sources: data.sources,
      usageCount: 0,
      lastUsedAt: null,
      usedInProjectIds: [],
      currentVersion: 1,
      versions: [{
        version: 1,
        text: data.answer,
        createdAt: now,
        createdBy: userId,
      }],
      isArchived: false,
      archivedAt: null,
      confidenceScore: data.confidenceScore,
      approvalStatus: 'DRAFT',
      approvedBy: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
    };

    await docClient.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(item.orgId, item.kbId, item.id),
        ...item,
      },
    }));

    return apiResponse(201, { data: item });
  } catch (error) {
    console.error('Error creating content library item:', error);
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
    .use(httpErrorMiddleware())
);