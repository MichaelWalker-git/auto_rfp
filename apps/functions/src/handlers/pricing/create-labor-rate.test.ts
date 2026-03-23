jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

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
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './create-labor-rate';

const makeEvent = (body: Record<string, unknown>) => ({
  body: JSON.stringify(body),
  auth: { userId: 'user-123', userName: 'test-user' },
  queryStringParameters: {},
  headers: {},
  requestContext: { http: { sourceIp: '127.0.0.1' } },
});

describe('create-labor-rate handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('should create a labor rate with valid input', async () => {
    mockSend.mockResolvedValueOnce({}); // PutCommand

    const event = makeEvent({
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      position: 'Senior Engineer',
      baseRate: 75,
      overhead: 120,
      ga: 12,
      profit: 10,
      effectiveDate: '2024-01-01T00:00:00.000Z',
      isActive: true,
    });

    const result = await baseHandler(event as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(parsed.laborRate).toBeDefined();
    expect(parsed.laborRate.position).toBe('Senior Engineer');
    expect(parsed.laborRate.fullyLoadedRate).toBeGreaterThan(0);
  });

  it('should return 400 for invalid payload', async () => {
    const event = makeEvent({
      orgId: 'not-a-uuid',
      position: '',
    });

    const result = await baseHandler(event as never);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });

  it('should calculate fully loaded rate correctly', async () => {
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({
      orgId: '550e8400-e29b-41d4-a716-446655440000',
      position: 'Junior Developer',
      baseRate: 50,
      overhead: 100, // 100% overhead
      ga: 10,        // 10% G&A
      profit: 10,    // 10% profit
      effectiveDate: '2024-01-01T00:00:00.000Z',
    });

    const result = await baseHandler(event as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    // 50 * (1 + 100/100) = 100
    // 100 * (1 + 10/100) = 110
    // 110 * (1 + 10/100) = 121
    expect(parsed.laborRate.fullyLoadedRate).toBe(121);
  });
});
