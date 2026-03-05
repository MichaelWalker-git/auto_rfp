// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Mock Sentry
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

// Mock audit middleware
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Mock clustering helper
const mockBatchCheckAnswers = jest.fn();
jest.mock('@/helpers/clustering', () => ({
  batchCheckAnswers: mockBatchCheckAnswers,
}));

// Mock API helpers
jest.mock('@/helpers/api', () => ({
  apiResponse: jest.fn((statusCode: number, body: unknown) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })),
  getOrgId: jest.fn(() => 'org-123'),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './get-clusters';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// Helper to extract body from APIGatewayProxyResultV2
const parseResult = (result: unknown) => {
  const r = result as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
};

const createEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent => ({
  pathParameters: { projectId: 'proj-123' },
  queryStringParameters: {},
  headers: {},
  body: null,
  isBase64Encoded: false,
  requestContext: {} as AuthedEvent['requestContext'],
  auth: { userId: 'user-1', claims: {} },
  ...overrides,
} as AuthedEvent);

describe('get-clusters handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockBatchCheckAnswers.mockReset();
  });

  it('returns 400 when projectId is missing', async () => {
    const event = createEvent({ pathParameters: {} });
    const { statusCode, body } = parseResult(await baseHandler(event));
    expect(body.message).toBe('Missing projectId');
    expect(statusCode).toBe(400);
  });

  it('returns empty clusters when none found', async () => {
    mockSend.mockResolvedValue({ Items: [] });

    const event = createEvent();
    const { body } = parseResult(await baseHandler(event));

    expect(body.projectId).toBe('proj-123');
    expect(body.clusters).toEqual([]);
    expect(body.totalClusters).toBe(0);
  });

  it('returns clusters with updated hasAnswer status', async () => {
    const mockClusters = [
      {
        clusterId: 'cluster-1',
        projectId: 'proj-123',
        opportunityId: 'opp-1',
        questionFileId: 'file-1',
        masterQuestionId: 'q-master',
        masterQuestionText: 'What is the timeline?',
        members: [
          { questionId: 'q-1', questionText: 'Timeline?', similarity: 0.9, hasAnswer: false },
          { questionId: 'q-2', questionText: 'Schedule?', similarity: 0.85, hasAnswer: false },
        ],
        avgSimilarity: 0.875,
        questionCount: 2,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    mockSend.mockResolvedValue({ Items: mockClusters });
    mockBatchCheckAnswers.mockResolvedValue(new Set(['q-1']));

    const event = createEvent();
    const { body } = parseResult(await baseHandler(event));

    expect(body.clusters).toHaveLength(1);
    expect(body.clusters[0].members[0].hasAnswer).toBe(true);
    expect(body.clusters[0].members[1].hasAnswer).toBe(false);
    expect(body.totalClusters).toBe(1);
  });

  it('filters clusters by opportunityId', async () => {
    const mockClusters = [
      {
        clusterId: 'cluster-1',
        projectId: 'proj-123',
        opportunityId: 'opp-1',
        questionFileId: '',
        masterQuestionId: 'q-1',
        masterQuestionText: 'Q1',
        members: [],
        avgSimilarity: 0.9,
        questionCount: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        clusterId: 'cluster-2',
        projectId: 'proj-123',
        opportunityId: 'opp-2',
        questionFileId: '',
        masterQuestionId: 'q-2',
        masterQuestionText: 'Q2',
        members: [],
        avgSimilarity: 0.85,
        questionCount: 1,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    mockSend.mockResolvedValue({ Items: mockClusters });
    mockBatchCheckAnswers.mockResolvedValue(new Set());

    const event = createEvent({
      queryStringParameters: { opportunityId: 'opp-1' },
    });
    const { body } = parseResult(await baseHandler(event));

    expect(body.clusters).toHaveLength(1);
    expect(body.clusters[0].clusterId).toBe('cluster-1');
  });

  it('sorts clusters by questionCount descending', async () => {
    const mockClusters = [
      {
        clusterId: 'small',
        projectId: 'proj-123',
        masterQuestionId: 'q-1',
        masterQuestionText: 'Q1',
        members: [],
        avgSimilarity: 0.9,
        questionCount: 2,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        clusterId: 'large',
        projectId: 'proj-123',
        masterQuestionId: 'q-2',
        masterQuestionText: 'Q2',
        members: [],
        avgSimilarity: 0.85,
        questionCount: 5,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    mockSend.mockResolvedValue({ Items: mockClusters });
    mockBatchCheckAnswers.mockResolvedValue(new Set());

    const event = createEvent();
    const { body } = parseResult(await baseHandler(event));

    expect(body.clusters[0].clusterId).toBe('large');
    expect(body.clusters[1].clusterId).toBe('small');
  });

  it('sets audit context with CLUSTERS_VIEWED action', async () => {
    mockSend.mockResolvedValue({ Items: [] });
    mockBatchCheckAnswers.mockResolvedValue(new Set());

    const event = createEvent();
    await baseHandler(event);

    const { setAuditContext } = jest.requireMock('@/middleware/audit-middleware');
    expect(setAuditContext).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        action: 'CLUSTERS_VIEWED',
        resource: 'question',
        resourceId: 'proj-123',
      }),
    );
  });

  it('handles database errors', async () => {
    mockSend.mockRejectedValue(new Error('Database connection failed'));

    const event = createEvent();
    await expect(baseHandler(event)).rejects.toThrow('Database connection failed');
  });
});
