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
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
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

// Mock the db helper — capture updateItem calls, leave docClient to the SDK mock
const mockUpdateItem = jest.fn();
jest.mock('@/helpers/db', () => {
  const actual = jest.requireActual('@/helpers/db');
  return {
    ...actual,
    updateItem: mockUpdateItem,
  };
});

// Mock question helper — deterministic SK builder
jest.mock('@/helpers/question', () => ({
  buildQuestionSK: jest.fn((...args: string[]) => args.join('#')),
}));

// Mock collaboration helper (non-blocking activity log)
jest.mock('@/helpers/collaboration', () => ({
  createActivity: jest.fn(() => Promise.resolve()),
}));

// Mock date helper for deterministic timestamps
jest.mock('@/helpers/date', () => ({
  nowIso: jest.fn(() => '2026-01-01T00:00:00.000Z'),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { saveAnswer } from './save-answer';

describe('saveAnswer — resolution persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockUpdateItem.mockReset();
  });

  it('persists resolution when creating a new answer', async () => {
    // No existing answer found by the lookup query
    mockSend.mockResolvedValueOnce({ Items: [] });
    // PutCommand send for the create
    mockSend.mockResolvedValueOnce({});

    const result = await saveAnswer({
      questionId: 'q-123',
      projectId: 'proj-456',
      opportunityId: 'opp-001',
      questionFileId: 'file-1',
      text: '',
      resolution: 'NO_KB_MATCH',
    });

    expect(result.resolution).toBe('NO_KB_MATCH');

    // The second send call is the PutCommand — assert the persisted item carries resolution
    const putCall = mockSend.mock.calls[1]?.[0];
    expect(putCall.type).toBe('Put');
    expect(putCall.params.Item.resolution).toBe('NO_KB_MATCH');
  });

  it('does not write a resolution key when none is provided (legacy create)', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    mockSend.mockResolvedValueOnce({});

    await saveAnswer({
      questionId: 'q-123',
      projectId: 'proj-456',
      opportunityId: 'opp-001',
      questionFileId: 'file-1',
      text: 'An answer with no recorded resolution',
    });

    const putCall = mockSend.mock.calls[1]?.[0];
    expect(putCall.type).toBe('Put');
    expect('resolution' in putCall.params.Item).toBe(false);
  });

  it('persists resolution when updating an existing answer', async () => {
    // Existing answer returned by the lookup query
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'ANSWER', SK: 'proj-456#opp-001#file-1#q-123', id: 'ans-1', text: '' }],
    });
    mockUpdateItem.mockResolvedValueOnce({
      id: 'ans-1',
      questionId: 'q-123',
      text: 'Updated answer',
      resolution: 'ANSWERED',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await saveAnswer({
      questionId: 'q-123',
      projectId: 'proj-456',
      opportunityId: 'opp-001',
      questionFileId: 'file-1',
      text: 'Updated answer',
      resolution: 'ANSWERED',
    });

    expect(result.resolution).toBe('ANSWERED');

    // updateItem receives the updates object as its third argument
    const updates = mockUpdateItem.mock.calls[0]?.[2];
    expect(updates.resolution).toBe('ANSWERED');
  });

  it('omits resolution from updates when not provided (legacy update)', async () => {
    mockSend.mockResolvedValueOnce({
      Items: [{ PK: 'ANSWER', SK: 'proj-456#opp-001#file-1#q-123', id: 'ans-1', text: 'old' }],
    });
    mockUpdateItem.mockResolvedValueOnce({
      id: 'ans-1',
      questionId: 'q-123',
      text: 'edited',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await saveAnswer({
      questionId: 'q-123',
      projectId: 'proj-456',
      opportunityId: 'opp-001',
      questionFileId: 'file-1',
      text: 'edited',
    });

    const updates = mockUpdateItem.mock.calls[0]?.[2];
    expect('resolution' in updates).toBe(false);
  });
});
