// lambda/content-library/handlers.ts
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateContentLibraryItemDTOSchema,
  UpdateContentLibraryItemDTOSchema,
  SearchContentLibraryDTOSchema,
  CONTENT_LIBRARY_PK,
  createContentLibrarySK,
  ContentLibraryItem,
  CreateContentLibraryItemDTO,
  UpdateContentLibraryItemDTO,
  SearchContentLibraryDTO,
} from '../schemas/content-library';
import { withSentryLambda } from '../sentry-lambda';

// Initialize DynamoDB client
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const TABLE_NAME = process.env.DB_TABLE_NAME || 'auto-rfp-main';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
};

// Helper function to create API response
function createResponse(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
    body: JSON.stringify(body),
  };
}

// Helper to get user ID from event (from Cognito authorizer)
function getUserId(event: APIGatewayProxyEvent): string | null {
  try {
    const claims = event.requestContext?.authorizer?.claims;
    return claims?.sub || null;
  } catch {
    return null;
  }
}

// Helper to parse request body
function parseBody<T>(event: APIGatewayProxyEvent): T | null {
  try {
    if (!event.body) return null;
    return JSON.parse(event.body) as T;
  } catch {
    return null;
  }
}

// Helper to get user's organization ID from JWT claims
function getUserOrgId(event: APIGatewayProxyEvent): string | null {
  try {
    const claims = event.requestContext?.authorizer?.claims;
    return claims?.['custom:orgId'] || null;
  } catch {
    return null;
  }
}

// Helper to verify user has access to the requested organization
function verifyOrgAccess(event: APIGatewayProxyEvent, requestedOrgId: string): { authorized: boolean; error?: APIGatewayProxyResult } {
  const userOrgId = getUserOrgId(event);

  // If no auth claims available (e.g., local testing), allow access
  // In production, you may want to reject requests without valid auth
  if (!userOrgId) {
    // Allow access when running without Cognito auth (development mode)
    return { authorized: true };
  }

  if (userOrgId !== requestedOrgId) {
    return {
      authorized: false,
      error: createResponse(403, {
        error: 'Forbidden',
        message: 'You do not have access to this organization'
      }),
    };
  }

  return { authorized: true };
}

/**
 * Create a new content library item
 * POST /api/content-library/items
 */
export async function createContentLibraryItem(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const body = parseBody<CreateContentLibraryItemDTO>(event);
    if (!body) {
      return createResponse(400, { error: 'Invalid request body' });
    }

    const validation = CreateContentLibraryItemDTOSchema.safeParse(body);
    if (!validation.success) {
      return createResponse(400, { error: 'Validation failed', details: validation.error.format() });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, validation.data.orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    const userId = getUserId(event) || 'system';
    const now = new Date().toISOString();
    const itemId = uuidv4();

    const item: ContentLibraryItem = {
      id: itemId,
      orgId: validation.data.orgId,
      question: validation.data.question,
      answer: validation.data.answer,
      category: validation.data.category,
      tags: validation.data.tags || [],
      description: validation.data.description,
      sources: validation.data.sources,
      usageCount: 0,
      lastUsedAt: null,
      usedInProjectIds: [],
      currentVersion: 1,
      versions: [{
        version: 1,
        text: validation.data.answer,
        createdAt: now,
        createdBy: userId,
      }],
      isArchived: false,
      archivedAt: null,
      confidenceScore: validation.data.confidenceScore,
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
        sort_key: createContentLibrarySK(item.orgId, item.id),
        ...item,
      },
    }));

    return createResponse(201, { data: item });
  } catch (error) {
    console.error('Error creating content library item:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get a single content library item
 * GET /api/content-library/items/{id}?orgId={orgId}
 */
export async function getContentLibraryItem(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId;

    if (!itemId || !orgId) {
      return createResponse(400, { error: 'Missing itemId or orgId' });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, itemId),
      },
    }));

    if (!result.Item) {
      return createResponse(404, { error: 'Content library item not found' });
    }

    // Remove DynamoDB keys from response
    const { partition_key, sort_key, ...item } = result.Item;
    return createResponse(200, { data: item });
  } catch (error) {
    console.error('Error getting content library item:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * List/search content library items
 * GET /api/content-library/items?orgId={orgId}&query={query}&category={category}
 */
export async function listContentLibraryItems(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const params = event.queryStringParameters || {};

    const searchParams: SearchContentLibraryDTO = {
      orgId: params.orgId || '',
      query: params.query,
      category: params.category,
      tags: params.tags ? params.tags.split(',') : undefined,
      approvalStatus: params.approvalStatus as 'DRAFT' | 'APPROVED' | 'DEPRECATED' | undefined,
      excludeArchived: params.excludeArchived !== 'false',
      limit: parseInt(params.limit || '20', 10),
      offset: parseInt(params.offset || '0', 10),
    };

    const validation = SearchContentLibraryDTOSchema.safeParse(searchParams);
    if (!validation.success) {
      return createResponse(400, { error: 'Validation failed', details: validation.error.format() });
    }

    const { orgId, query, category, tags, approvalStatus, excludeArchived, limit, offset } = validation.data;

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    // Query DynamoDB - get all items for the org, then filter
    // NOTE: This in-memory filtering and pagination is a known scalability limitation
    // for large organizations. It will be replaced with DynamoDB-level pagination
    // and/or OpenSearch-based filtering in planned follow-up work.
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'partition_key = :pk AND begins_with(sort_key, :sk_prefix)',
      ExpressionAttributeValues: {
        ':pk': CONTENT_LIBRARY_PK,
        ':sk_prefix': `${orgId}#`,
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

    // Apply pagination
    const paginatedItems = items.slice(offset, offset + limit);

    return createResponse(200, {
      data: {
        items: paginatedItems,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    console.error('Error listing content library items:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Update a content library item
 * PATCH /api/content-library/items/{id}?orgId={orgId}
 */
export async function updateContentLibraryItem(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId;

    if (!itemId || !orgId) {
      return createResponse(400, { error: 'Missing itemId or orgId' });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    const body = parseBody<UpdateContentLibraryItemDTO>(event);
    if (!body) {
      return createResponse(400, { error: 'Invalid request body' });
    }

    const validation = UpdateContentLibraryItemDTOSchema.safeParse(body);
    if (!validation.success) {
      return createResponse(400, { error: 'Validation failed', details: validation.error.format() });
    }

    const userId = getUserId(event) || 'system';
    const now = new Date().toISOString();
    const updateData = validation.data;

    // First get the existing item
    const existingResult = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, itemId),
      },
    }));

    if (!existingResult.Item) {
      return createResponse(404, { error: 'Content library item not found' });
    }

    const existing = existingResult.Item as ContentLibraryItem;

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
      // Create new version entry
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
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, itemId),
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    }));

    // Fetch the updated item
    const updatedResult = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, itemId),
      },
    }));

    const { partition_key, sort_key, ...updatedItem } = updatedResult.Item || {};
    return createResponse(200, { data: updatedItem });
  } catch (error) {
    console.error('Error updating content library item:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Delete (archive) a content library item
 * DELETE /api/content-library/items/{id}?orgId={orgId}
 */
export async function deleteContentLibraryItem(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId;
    const hardDelete = event.queryStringParameters?.hardDelete === 'true';

    if (!itemId || !orgId) {
      return createResponse(400, { error: 'Missing itemId or orgId' });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    const key = {
      partition_key: CONTENT_LIBRARY_PK,
      sort_key: createContentLibrarySK(orgId, itemId),
    };

    if (hardDelete) {
      // Hard delete - permanently remove
      await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: key,
      }));
      return createResponse(200, { message: 'Item permanently deleted' });
    } else {
      // Soft delete - archive
      const now = new Date().toISOString();
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: 'SET #isArchived = :isArchived, #archivedAt = :archivedAt, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#isArchived': 'isArchived',
          '#archivedAt': 'archivedAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':isArchived': true,
          ':archivedAt': now,
          ':updatedAt': now,
        },
      }));
      return createResponse(200, { message: 'Item archived' });
    }
  } catch (error) {
    console.error('Error deleting content library item:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Approve a content library item
 * POST /api/content-library/items/{id}/approve?orgId={orgId}
 */
export async function approveContentLibraryItem(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId;

    if (!itemId || !orgId) {
      return createResponse(400, { error: 'Missing itemId or orgId' });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    // Check if item exists and is not archived before approving
    const existingResult = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, itemId),
      },
    }));

    if (!existingResult.Item) {
      return createResponse(404, { error: 'Content library item not found' });
    }

    if (existingResult.Item.isArchived) {
      return createResponse(400, { error: 'Cannot approve an archived item' });
    }

    const body = parseBody<{ approvedBy?: string }>(event);
    const userId = body?.approvedBy || getUserId(event) || 'system';
    const now = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, itemId),
      },
      UpdateExpression: 'SET #approvalStatus = :status, #approvedBy = :approvedBy, #approvedAt = :approvedAt, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#approvalStatus': 'approvalStatus',
        '#approvedBy': 'approvedBy',
        '#approvedAt': 'approvedAt',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'APPROVED',
        ':approvedBy': userId,
        ':approvedAt': now,
        ':updatedAt': now,
      },
    }));

    return createResponse(200, { message: 'Item approved' });
  } catch (error) {
    console.error('Error approving content library item:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Deprecate a content library item
 * POST /api/content-library/items/{id}/deprecate?orgId={orgId}
 */
export async function deprecateContentLibraryItem(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId;

    if (!itemId || !orgId) {
      return createResponse(400, { error: 'Missing itemId or orgId' });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    const now = new Date().toISOString();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, itemId),
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

    return createResponse(200, { message: 'Item deprecated' });
  } catch (error) {
    console.error('Error deprecating content library item:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Track usage of a content library item (called when item is used in an answer)
 * POST /api/content-library/items/{id}/track-usage?orgId={orgId}
 */
export async function trackContentLibraryUsage(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId;
    const body = parseBody<{ projectId: string }>(event);

    if (!itemId || !orgId) {
      return createResponse(400, { error: 'Missing itemId or orgId' });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    if (!body?.projectId) {
      return createResponse(400, { error: 'Missing projectId in request body' });
    }

    const now = new Date().toISOString();
    const key = {
      partition_key: CONTENT_LIBRARY_PK,
      sort_key: createContentLibrarySK(orgId, itemId),
    };

    // Always increment usageCount and update lastUsedAt
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

    // Append projectId to usedInProjectIds only if not already present
    // Use conditional expression to prevent duplicates
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
          ':projectId': [body.projectId],
          ':projectIdStr': body.projectId,
          ':emptyList': [],
        },
      }));
    } catch (conditionalError: unknown) {
      // Ignore ConditionalCheckFailedException - projectId already exists in list
      if (
        conditionalError &&
        typeof conditionalError === 'object' &&
        'name' in conditionalError &&
        conditionalError.name !== 'ConditionalCheckFailedException'
      ) {
        throw conditionalError;
      }
    }

    return createResponse(200, { message: 'Usage tracked' });
  } catch (error) {
    console.error('Error tracking content library usage:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get distinct categories for an organization
 * GET /api/content-library/categories?orgId={orgId}
 */
export async function getContentLibraryCategories(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const orgId = event.queryStringParameters?.orgId;

    if (!orgId) {
      return createResponse(400, { error: 'Missing orgId' });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'partition_key = :pk AND begins_with(sort_key, :sk_prefix)',
      ExpressionAttributeValues: {
        ':pk': CONTENT_LIBRARY_PK,
        ':sk_prefix': `${orgId}#`,
      },
      ProjectionExpression: 'category, isArchived',
    }));

    const categoryCount = new Map<string, number>();

    for (const item of result.Items || []) {
      if (item.isArchived) continue;
      const category = item.category as string;
      categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
    }

    const categories = Array.from(categoryCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return createResponse(200, { data: { categories } });
  } catch (error) {
    console.error('Error getting content library categories:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Get distinct tags for an organization
 * GET /api/content-library/tags?orgId={orgId}
 */
export async function getContentLibraryTags(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const orgId = event.queryStringParameters?.orgId;

    if (!orgId) {
      return createResponse(400, { error: 'Missing orgId' });
    }

    // Verify user has access to the organization
    const authCheck = verifyOrgAccess(event, orgId);
    if (!authCheck.authorized) {
      return authCheck.error!;
    }

    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'partition_key = :pk AND begins_with(sort_key, :sk_prefix)',
      ExpressionAttributeValues: {
        ':pk': CONTENT_LIBRARY_PK,
        ':sk_prefix': `${orgId}#`,
      },
      ProjectionExpression: 'tags, isArchived',
    }));

    const tagCount = new Map<string, number>();

    for (const item of result.Items || []) {
      if (item.isArchived) continue;
      const tags = (item.tags as string[]) || [];
      for (const tag of tags) {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      }
    }

    const tags = Array.from(tagCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return createResponse(200, { data: { tags } });
  } catch (error) {
    console.error('Error getting content library tags:', error);
    return createResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}


// Wrapped handlers for Lambda deployment with Sentry error tracking
export const createContentLibraryItemHandler = withSentryLambda(createContentLibraryItem);
export const getContentLibraryItemHandler = withSentryLambda(getContentLibraryItem);
export const listContentLibraryItemsHandler = withSentryLambda(listContentLibraryItems);
export const updateContentLibraryItemHandler = withSentryLambda(updateContentLibraryItem);
export const deleteContentLibraryItemHandler = withSentryLambda(deleteContentLibraryItem);
export const approveContentLibraryItemHandler = withSentryLambda(approveContentLibraryItem);
export const deprecateContentLibraryItemHandler = withSentryLambda(deprecateContentLibraryItem);
export const trackContentLibraryUsageHandler = withSentryLambda(trackContentLibraryUsage);
export const getContentLibraryCategoriesHandler = withSentryLambda(getContentLibraryCategories);
export const getContentLibraryTagsHandler = withSentryLambda(getContentLibraryTags);
