// lambda/content-library/handlers.test.ts
import { APIGatewayProxyEvent } from 'aws-lambda';

// Mock uuid before importing handlers
jest.mock('uuid', () => ({
  v4: jest.fn(() => '550e8400-e29b-41d4-a716-446655440099'),
}));

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));

import {
  createContentLibraryItem,
  getContentLibraryItem,
  listContentLibraryItems,
  updateContentLibraryItem,
  deleteContentLibraryItem,
  approveContentLibraryItem,
  deprecateContentLibraryItem,
  trackContentLibraryUsage,
  getContentLibraryCategories,
  getContentLibraryTags,
} from './handlers';

// Helper to create mock API Gateway event
function createMockEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    body: null,
    headers: {},
    multiValueHeaders: {},
    httpMethod: 'GET',
    isBase64Encoded: false,
    path: '/api/content-library/items',
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {
      authorizer: {
        claims: { sub: 'test-user-id' },
      },
    } as any,
    resource: '',
    ...overrides,
  };
}

describe('Content Library Handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('createContentLibraryItem', () => {
    const validBody = {
      orgId: '550e8400-e29b-41d4-a716-446655440001',
      question: 'What is your company background?',
      answer: 'We are a leading provider...',
      category: 'Company Background',
      tags: ['company', 'about-us'],
    };

    it('creates a new content library item successfully', async () => {
      mockSend.mockResolvedValueOnce({});

      const event = createMockEvent({
        httpMethod: 'POST',
        body: JSON.stringify(validBody),
      });

      const result = await createContentLibraryItem(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(201);
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe('550e8400-e29b-41d4-a716-446655440099');
      expect(body.data.question).toBe(validBody.question);
      expect(body.data.answer).toBe(validBody.answer);
      expect(body.data.approvalStatus).toBe('DRAFT');
      expect(body.data.usageCount).toBe(0);
      expect(body.data.versions).toHaveLength(1);
    });

    it('returns 400 for invalid request body', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        body: JSON.stringify({ orgId: 'not-a-uuid' }),
      });

      const result = await createContentLibraryItem(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Validation failed');
    });

    it('returns 400 for missing body', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        body: null,
      });

      const result = await createContentLibraryItem(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Invalid request body');
    });
  });

  describe('getContentLibraryItem', () => {
    const mockItem = {
      partition_key: 'CONTENT_LIBRARY',
      sort_key: '550e8400-e29b-41d4-a716-446655440001#550e8400-e29b-41d4-a716-446655440099',
      id: '550e8400-e29b-41d4-a716-446655440099',
      orgId: '550e8400-e29b-41d4-a716-446655440001',
      question: 'What is your company?',
      answer: 'We are...',
      category: 'Company',
    };

    it('returns item when found', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const event = createMockEvent({
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
      });

      const result = await getContentLibraryItem(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.id).toBe('550e8400-e29b-41d4-a716-446655440099');
      // Verify DynamoDB keys are not in response
      expect(body.data.partition_key).toBeUndefined();
      expect(body.data.sort_key).toBeUndefined();
    });

    it('returns 404 when item not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = createMockEvent({
        pathParameters: { id: 'nonexistent-id' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
      });

      const result = await getContentLibraryItem(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).error).toBe('Content library item not found');
    });

    it('returns 400 when missing parameters', async () => {
      const event = createMockEvent({
        pathParameters: null,
        queryStringParameters: null,
      });

      const result = await getContentLibraryItem(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Missing itemId or orgId');
    });
  });

  describe('listContentLibraryItems', () => {
    const mockItems = [
      {
        partition_key: 'CONTENT_LIBRARY',
        sort_key: 'org#item1',
        id: 'item1',
        question: 'Q1',
        answer: 'A1',
        category: 'Technical',
        tags: ['tech'],
        isArchived: false,
        approvalStatus: 'APPROVED',
      },
      {
        partition_key: 'CONTENT_LIBRARY',
        sort_key: 'org#item2',
        id: 'item2',
        question: 'Q2',
        answer: 'A2',
        category: 'Company',
        tags: ['company'],
        isArchived: false,
        approvalStatus: 'DRAFT',
      },
      {
        partition_key: 'CONTENT_LIBRARY',
        sort_key: 'org#item3',
        id: 'item3',
        question: 'Q3',
        answer: 'A3',
        category: 'Technical',
        tags: ['tech'],
        isArchived: true,
        approvalStatus: 'APPROVED',
      },
    ];

    it('returns paginated items', async () => {
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const event = createMockEvent({
        queryStringParameters: {
          orgId: '550e8400-e29b-41d4-a716-446655440001',
        },
      });

      const result = await listContentLibraryItems(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      // Should exclude archived items by default
      expect(body.data.items).toHaveLength(2);
      expect(body.data.total).toBe(2);
    });

    it('filters by category', async () => {
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const event = createMockEvent({
        queryStringParameters: {
          orgId: '550e8400-e29b-41d4-a716-446655440001',
          category: 'Technical',
        },
      });

      const result = await listContentLibraryItems(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].category).toBe('Technical');
    });

    it('filters by approval status', async () => {
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const event = createMockEvent({
        queryStringParameters: {
          orgId: '550e8400-e29b-41d4-a716-446655440001',
          approvalStatus: 'APPROVED',
        },
      });

      const result = await listContentLibraryItems(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].approvalStatus).toBe('APPROVED');
    });

    it('searches by query string', async () => {
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const event = createMockEvent({
        queryStringParameters: {
          orgId: '550e8400-e29b-41d4-a716-446655440001',
          query: 'Q1',
        },
      });

      const result = await listContentLibraryItems(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.items).toHaveLength(1);
      expect(body.data.items[0].question).toBe('Q1');
    });

    it('returns 400 for invalid orgId', async () => {
      const event = createMockEvent({
        queryStringParameters: {
          orgId: 'not-a-uuid',
        },
      });

      const result = await listContentLibraryItems(event);

      expect(result.statusCode).toBe(400);
    });
  });

  describe('updateContentLibraryItem', () => {
    const existingItem = {
      id: '550e8400-e29b-41d4-a716-446655440099',
      orgId: '550e8400-e29b-41d4-a716-446655440001',
      currentVersion: 1,
      versions: [{ version: 1, text: 'Original', createdAt: '2025-01-01T00:00:00Z', createdBy: 'user1' }],
    };

    it('updates item successfully', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: existingItem }) // Get existing
        .mockResolvedValueOnce({}) // Update
        .mockResolvedValueOnce({ Item: { ...existingItem, answer: 'Updated answer' } }); // Get updated

      const event = createMockEvent({
        httpMethod: 'PATCH',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
        body: JSON.stringify({ answer: 'Updated answer', changeNotes: 'Fixed typo' }),
      });

      const result = await updateContentLibraryItem(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data).toBeDefined();
    });

    it('returns 404 when item not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = createMockEvent({
        httpMethod: 'PATCH',
        pathParameters: { id: 'nonexistent' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
        body: JSON.stringify({ answer: 'New answer' }),
      });

      const result = await updateContentLibraryItem(event);

      expect(result.statusCode).toBe(404);
    });
  });

  describe('deleteContentLibraryItem', () => {
    it('soft deletes (archives) by default', async () => {
      mockSend.mockResolvedValueOnce({});

      const event = createMockEvent({
        httpMethod: 'DELETE',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
      });

      const result = await deleteContentLibraryItem(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.message).toBe('Item archived');
      // Verify UpdateCommand was called, not DeleteCommand
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'Update' }));
    });

    it('hard deletes when hardDelete=true', async () => {
      mockSend.mockResolvedValueOnce({});

      const event = createMockEvent({
        httpMethod: 'DELETE',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: {
          orgId: '550e8400-e29b-41d4-a716-446655440001',
          hardDelete: 'true',
        },
      });

      const result = await deleteContentLibraryItem(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.message).toBe('Item permanently deleted');
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'Delete' }));
    });
  });

  describe('approveContentLibraryItem', () => {
    const mockExistingItem = {
      id: '550e8400-e29b-41d4-a716-446655440099',
      orgId: '550e8400-e29b-41d4-a716-446655440001',
      approvalStatus: 'DRAFT',
      isArchived: false,
    };

    it('approves item successfully', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: mockExistingItem }) // Get existing
        .mockResolvedValueOnce({}); // Update

      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
        body: JSON.stringify({}),
      });

      const result = await approveContentLibraryItem(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.message).toBe('Item approved');
    });

    it('returns 404 when item not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: null });

      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: { id: 'nonexistent' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
        body: JSON.stringify({}),
      });

      const result = await approveContentLibraryItem(event);

      expect(result.statusCode).toBe(404);
      expect(JSON.parse(result.body).error).toBe('Content library item not found');
    });

    it('returns 400 when trying to approve archived item', async () => {
      mockSend.mockResolvedValueOnce({ Item: { ...mockExistingItem, isArchived: true } });

      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
        body: JSON.stringify({}),
      });

      const result = await approveContentLibraryItem(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Cannot approve an archived item');
    });
  });

  describe('deprecateContentLibraryItem', () => {
    it('deprecates item successfully', async () => {
      mockSend.mockResolvedValueOnce({});

      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
      });

      const result = await deprecateContentLibraryItem(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.message).toBe('Item deprecated');
      expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ type: 'Update' }));
    });

    it('returns 400 when missing itemId or orgId', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: null,
        queryStringParameters: null,
      });

      const result = await deprecateContentLibraryItem(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Missing itemId or orgId');
    });

    it('handles DynamoDB errors gracefully', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
      });

      const result = await deprecateContentLibraryItem(event);

      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toBe('Internal server error');
    });
  });

  describe('trackContentLibraryUsage', () => {
    it('tracks usage successfully', async () => {
      // First call increments usage count, second call adds projectId
      mockSend
        .mockResolvedValueOnce({}) // Increment usage count
        .mockResolvedValueOnce({}); // Add projectId to list

      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
        body: JSON.stringify({ projectId: '550e8400-e29b-41d4-a716-446655440002' }),
      });

      const result = await trackContentLibraryUsage(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.message).toBe('Usage tracked');
      // Verify two update calls were made
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('handles duplicate projectId gracefully', async () => {
      // First call succeeds, second call fails with ConditionalCheckFailedException
      const conditionalError = new Error('Conditional check failed');
      (conditionalError as Error & { name: string }).name = 'ConditionalCheckFailedException';

      mockSend
        .mockResolvedValueOnce({}) // Increment usage count
        .mockRejectedValueOnce(conditionalError); // projectId already exists

      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
        body: JSON.stringify({ projectId: '550e8400-e29b-41d4-a716-446655440002' }),
      });

      const result = await trackContentLibraryUsage(event);
      const body = JSON.parse(result.body);

      // Should still succeed - duplicate projectId is ignored
      expect(result.statusCode).toBe(200);
      expect(body.message).toBe('Usage tracked');
    });

    it('returns 400 when projectId is missing', async () => {
      const event = createMockEvent({
        httpMethod: 'POST',
        pathParameters: { id: '550e8400-e29b-41d4-a716-446655440099' },
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
        body: JSON.stringify({}),
      });

      const result = await trackContentLibraryUsage(event);

      expect(result.statusCode).toBe(400);
      expect(JSON.parse(result.body).error).toBe('Missing projectId in request body');
    });
  });

  describe('getContentLibraryCategories', () => {
    it('returns distinct categories with counts', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { category: 'Technical', isArchived: false },
          { category: 'Technical', isArchived: false },
          { category: 'Company', isArchived: false },
          { category: 'Archived', isArchived: true },
        ],
      });

      const event = createMockEvent({
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
      });

      const result = await getContentLibraryCategories(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.categories).toEqual([
        { name: 'Technical', count: 2 },
        { name: 'Company', count: 1 },
      ]);
    });
  });

  describe('getContentLibraryTags', () => {
    it('returns distinct tags with counts', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          { tags: ['cloud', 'aws'], isArchived: false },
          { tags: ['cloud', 'azure'], isArchived: false },
          { tags: ['security'], isArchived: false },
          { tags: ['archived-tag'], isArchived: true },
        ],
      });

      const event = createMockEvent({
        queryStringParameters: { orgId: '550e8400-e29b-41d4-a716-446655440001' },
      });

      const result = await getContentLibraryTags(event);
      const body = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(body.data.tags).toContainEqual({ name: 'cloud', count: 2 });
      expect(body.data.tags).toContainEqual({ name: 'aws', count: 1 });
      expect(body.data.tags).toContainEqual({ name: 'azure', count: 1 });
      expect(body.data.tags).toContainEqual({ name: 'security', count: 1 });
    });
  });
});
