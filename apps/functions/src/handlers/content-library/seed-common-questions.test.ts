jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  BatchWriteCommand: jest.fn((params: unknown) => ({ type: 'BatchWrite', params })),
}));

const mockQueryBySkPrefix = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  queryBySkPrefix: (...args: unknown[]) => mockQueryBySkPrefix(...args),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({ before: jest.fn() }),
  httpErrorMiddleware: () => ({ onError: jest.fn() }),
  orgMembershipMiddleware: () => ({ before: jest.fn() }),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({ after: jest.fn() }),
  setAuditContext: jest.fn(),
}));

const mockIndexContentLibrary = jest.fn();
jest.mock('@/helpers/content-library', () => ({
  indexContentLibrary: (...args: unknown[]) => mockIndexContentLibrary(...args),
}));

jest.mock('@/helpers/date', () => ({
  nowIso: () => '2025-01-01T00:00:00.000Z',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { COMMON_RFP_QUESTIONS } from './common-rfp-questions';

// Dynamic import after mocks
const importHandler = async () => {
  const mod = await import('./seed-common-questions');
  // The handler is middy-wrapped; access the inner handler
  return (mod.handler as unknown as { handler: (event: AuthedEvent) => Promise<unknown> }).handler;
};

const makeEvent = (body: Record<string, unknown>, orgId = 'org-111'): AuthedEvent =>
  ({
    queryStringParameters: orgId ? { orgId } : {},
    body: JSON.stringify(body),
    headers: {},
    auth: { userId: 'user-999', userName: 'Test User' },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
  }) as unknown as AuthedEvent;

const parseBody = (result: unknown) => {
  const r = result as { body?: string };
  return JSON.parse(r.body ?? '{}');
};

describe('seed-common-questions handler', () => {
  let baseHandler: (event: AuthedEvent) => Promise<unknown>;

  beforeAll(async () => {
    baseHandler = await importHandler();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockQueryBySkPrefix.mockReset();
    mockIndexContentLibrary.mockReset();
    mockIndexContentLibrary.mockResolvedValue('indexed-id');
  });

  it('returns 400 when orgId is missing', async () => {
    const event = makeEvent({}, '');
    const result = await baseHandler(event);
    const body = parseBody(result);
    expect(body.error).toBe('orgId is required');
  });

  it('returns 400 for invalid priority value', async () => {
    const event = makeEvent({ orgId: 'org-111', priority: 'INVALID' });
    const result = await baseHandler(event);
    const body = parseBody(result);
    expect(body.error).toContain('priority must be');
  });

  it('seeds all questions when library is empty', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([]);
    mockSend.mockResolvedValue({});

    const event = makeEvent({ orgId: 'org-111' });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.created).toBe(COMMON_RFP_QUESTIONS.length);
    expect(body.skipped).toBe(0);
    expect(mockSend).toHaveBeenCalled();
  });

  it('filters by HIGH priority when specified', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([]);
    mockSend.mockResolvedValue({});

    const highCount = COMMON_RFP_QUESTIONS.filter((q) => q.priority === 'HIGH').length;

    const event = makeEvent({ orgId: 'org-111', priority: 'HIGH' });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.created).toBe(highCount);
  });

  it('filters by MEDIUM priority when specified', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([]);
    mockSend.mockResolvedValue({});

    const mediumCount = COMMON_RFP_QUESTIONS.filter((q) => q.priority === 'MEDIUM').length;

    const event = makeEvent({ orgId: 'org-111', priority: 'MEDIUM' });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.created).toBe(mediumCount);
  });

  it('skips questions that already exist (deduplication by question text)', async () => {
    // Simulate two existing questions in the library
    const existingQuestions = COMMON_RFP_QUESTIONS.slice(0, 2).map((q) => ({
      question: q.question,
      id: 'existing-id',
    }));
    mockQueryBySkPrefix.mockResolvedValueOnce(existingQuestions);
    mockSend.mockResolvedValue({});

    const event = makeEvent({ orgId: 'org-111' });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.created).toBe(COMMON_RFP_QUESTIONS.length - 2);
    expect(body.skipped).toBe(2);
  });

  it('returns 200 with zero created when all questions already exist', async () => {
    const existingQuestions = COMMON_RFP_QUESTIONS.map((q) => ({
      question: q.question,
      id: 'existing-id',
    }));
    mockQueryBySkPrefix.mockResolvedValueOnce(existingQuestions);

    const event = makeEvent({ orgId: 'org-111' });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.created).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('writes in batches of 25', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([]);
    mockSend.mockResolvedValue({});

    const event = makeEvent({ orgId: 'org-111' });
    await baseHandler(event);

    // 28 questions → ceil(28/25) = 2 batch writes
    const expectedBatches = Math.ceil(COMMON_RFP_QUESTIONS.length / 25);
    expect(mockSend).toHaveBeenCalledTimes(expectedBatches);
  });

  it('indexes each item in Pinecone after DynamoDB write', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([]);
    mockSend.mockResolvedValue({});

    const event = makeEvent({ orgId: 'org-111' });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(mockIndexContentLibrary).toHaveBeenCalledTimes(COMMON_RFP_QUESTIONS.length);
    expect(body.indexed).toBe(COMMON_RFP_QUESTIONS.length);
    // First call should be with orgId and a DB item
    expect(mockIndexContentLibrary.mock.calls[0][0]).toBe('org-111');
  });

  it('continues seeding even if Pinecone indexing fails for some items', async () => {
    mockQueryBySkPrefix.mockResolvedValueOnce([]);
    mockSend.mockResolvedValue({});
    // Fail on first index call, succeed on the rest
    mockIndexContentLibrary
      .mockRejectedValueOnce(new Error('Pinecone timeout'))
      .mockResolvedValue('indexed-id');

    const event = makeEvent({ orgId: 'org-111' });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.created).toBe(COMMON_RFP_QUESTIONS.length);
    expect(body.indexed).toBe(COMMON_RFP_QUESTIONS.length - 1);
  });

  it('creates items as DRAFT with correct structure', async () => {
    // Only seed 1 question (HIGH priority, filter to just company overview)
    const existingQuestions = COMMON_RFP_QUESTIONS.slice(1).map((q) => ({
      question: q.question,
      id: 'existing-id',
    }));
    mockQueryBySkPrefix.mockResolvedValueOnce(existingQuestions);
    mockSend.mockResolvedValue({});

    const event = makeEvent({ orgId: 'org-111' });
    await baseHandler(event);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const batchWriteArg = mockSend.mock.calls[0][0] as { params: { RequestItems: Record<string, Array<{ PutRequest: { Item: Record<string, unknown> } }>> } };
    const items = batchWriteArg.params.RequestItems['test-table'];
    expect(items).toHaveLength(1);

    const item = items[0].PutRequest.Item;
    expect(item.approvalStatus).toBe('DRAFT');
    expect(item.freshnessStatus).toBe('ACTIVE');
    expect(item.orgId).toBe('org-111');
    expect(item.createdBy).toBe('user-999');
    expect(item.currentVersion).toBe(1);
    expect(item.isArchived).toBe(false);
    expect(item.question).toBe(COMMON_RFP_QUESTIONS[0].question);
  });
});
