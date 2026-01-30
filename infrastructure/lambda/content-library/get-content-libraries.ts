import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  ContentLibraryItem,
  SearchContentLibraryDTO,
  SearchContentLibraryDTOSchema,
} from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { withSentryLambda } from '../sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '../middleware/rbac-middleware';
import { PK_NAME, SK_NAME } from '../constants/common';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const params = event.queryStringParameters || {};
    const orgId = params.orgId || getOrgId(event);
    const kbId = params.kbId


    if (!orgId || !kbId) {
      return apiResponse(400, { error: 'Missing orgId or kbId' });
    }

    const searchParams: SearchContentLibraryDTO = {
      orgId,
      kbId,
      query: params.query,
      category: params.category,
      tags: params.tags ? params.tags.split(',') : undefined,
      approvalStatus: params.approvalStatus as 'DRAFT' | 'APPROVED' | 'DEPRECATED' | undefined,
      excludeArchived: params.excludeArchived !== 'false',
      limit: parseInt(params.limit || '20', 10),
      offset: parseInt(params.offset || '0', 10),
    };

    const { success, data, error } = SearchContentLibraryDTOSchema.safeParse(searchParams);
    if (!success) {
      return apiResponse(400, { error: 'Validation failed', details: error.format() });
    }

    const { query, category, tags, approvalStatus, excludeArchived, limit, offset } = data;

    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk_prefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': CONTENT_LIBRARY_PK,
        ':sk_prefix': `${orgId}#${kbId}`,
      },
    }));

    let items = (result.Items || []).map((item) => {
      const { partition_key, sort_key, ...rest } = item;
      return rest as ContentLibraryItem;
    });

    // Apply filters
    if (excludeArchived) {
      items = items.filter((item) => !item.isArchived);
    }

    if (approvalStatus) {
      items = items.filter((item) => item.approvalStatus === approvalStatus);
    }

    if (category) {
      items = items.filter((item) =>
        item.category.toLowerCase() === category.toLowerCase()
      );
    }

    if (tags && tags.length > 0) {
      items = items.filter((item) =>
        tags.some((tag) => item.tags.includes(tag))
      );
    }

    if (query) {
      const lowerQuery = query.toLowerCase();
      items = items.filter((item) =>
        item.question.toLowerCase().includes(lowerQuery) ||
        item.answer.toLowerCase().includes(lowerQuery) ||
        item.tags.some((tag) => tag.toLowerCase().includes(lowerQuery))
      );
    }

    const total = items.length;

    const paginatedItems = items.slice(offset, offset + limit);

    return apiResponse(200, {
      items: paginatedItems,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    console.error('Error listing content library items:', error);
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