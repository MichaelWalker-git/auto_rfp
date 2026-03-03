import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  ContentLibraryItem,
  createContentLibrarySK,
  UpdateContentLibraryItemDTOSchema,
} from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { docClient, getItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware,   type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Update a content library item
 * PATCH /api/content-library/items/{id}?orgId={orgId}
 */
async function baseHandler(
  event: AuthedEvent
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const kbId = event.queryStringParameters?.kbId;

    if (!itemId) {
      return apiResponse(400, { error: 'Missing itemId' });
    }

    if (!orgId) {
      return apiResponse(400, { error: 'Missing orgId' });
    }

    const { success, data, error: errors } = UpdateContentLibraryItemDTOSchema.safeParse(
      JSON.parse(event.body || '{}'),
    );
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: errors.format() });
    }

    const userId = event.auth?.userId ?? 'system';
    const now = new Date().toISOString();
    const updateData = data;

    // Resolve SK: try new format (orgId#itemId) first, fall back to legacy (orgId#kbId#itemId)
    let sk = createContentLibrarySK(orgId, itemId);
    let existing = await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);
    if (!existing && kbId) {
      sk = createContentLibrarySK(orgId, kbId, itemId);
      existing = await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);
    }

    if (!existing) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    // Build update expression
    const updateExpressions: string[] = ['#updatedAt = :updatedAt', '#updatedBy = :updatedBy'];
    const expressionNames: Record<string, string> = {
      '#updatedAt': 'updatedAt',
      '#updatedBy': 'updatedBy',
    };
    const expressionValues: Record<string, unknown> = {
      ':updatedAt': now,
      ':updatedBy': userId,
    };

    if (updateData.question !== undefined) {
      updateExpressions.push('#question = :question');
      expressionNames['#question'] = 'question';
      expressionValues[':question'] = updateData.question;
    }

    if (updateData.answer !== undefined) {
      const newVersion = (existing.currentVersion || 1) + 1;
      const newVersionEntry = {
        version: newVersion,
        text: updateData.answer,
        createdAt: now,
        createdBy: userId,
        changeNotes: updateData.changeNotes,
      };

      updateExpressions.push('#answer = :answer');
      updateExpressions.push('#currentVersion = :currentVersion');
      updateExpressions.push('#versions = list_append(#versions, :newVersion)');
      expressionNames['#answer'] = 'answer';
      expressionNames['#currentVersion'] = 'currentVersion';
      expressionNames['#versions'] = 'versions';
      expressionValues[':answer'] = updateData.answer;
      expressionValues[':currentVersion'] = newVersion;
      expressionValues[':newVersion'] = [newVersionEntry];
    }

    if (updateData.category !== undefined) {
      updateExpressions.push('#category = :category');
      expressionNames['#category'] = 'category';
      expressionValues[':category'] = updateData.category;
    }

    if (updateData.tags !== undefined) {
      updateExpressions.push('#tags = :tags');
      expressionNames['#tags'] = 'tags';
      expressionValues[':tags'] = updateData.tags;
    }

    if (updateData.description !== undefined) {
      updateExpressions.push('#description = :description');
      expressionNames['#description'] = 'description';
      expressionValues[':description'] = updateData.description;
    }

    if (updateData.sources !== undefined) {
      updateExpressions.push('#sources = :sources');
      expressionNames['#sources'] = 'sources';
      expressionValues[':sources'] = updateData.sources;
    }

    if (updateData.confidenceScore !== undefined) {
      updateExpressions.push('#confidenceScore = :confidenceScore');
      expressionNames['#confidenceScore'] = 'confidenceScore';
      expressionValues[':confidenceScore'] = updateData.confidenceScore;
    }

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    }));

    // Fetch the updated item
    const updatedResult = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
    }));

    const item = updatedResult.Item ?? {};
    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'knowledge_base',
      resourceId: event.pathParameters?.id ?? 'unknown',
    });

    return apiResponse(200, item as ContentLibraryItem);
  } catch (error) {
    console.error('Error updating content library item:', error);
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