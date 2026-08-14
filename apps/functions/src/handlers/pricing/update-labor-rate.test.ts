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

import { baseHandler } from './update-labor-rate';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const RATE_ID = '550e8400-e29b-41d4-a716-446655440001';

const existingRate = {
  laborRateId: RATE_ID,
  orgId: ORG_ID,
  position: 'Senior Engineer',
  baseRate: 75,
  overhead: 120,
  ga: 12,
  profit: 10,
  fullyLoadedRate: 220.32,
  effectiveDate: '2024-01-01T00:00:00.000Z',
  isActive: true,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  createdBy: '550e8400-e29b-41d4-a716-446655440002',
  updatedBy: '550e8400-e29b-41d4-a716-446655440002',
};

const makeEvent = (body: Record<string, unknown>) => ({
  body: JSON.stringify(body),
  auth: { userId: 'user-123', userName: 'test-user' },
  queryStringParameters: {},
  headers: {},
  requestContext: { http: { sourceIp: '127.0.0.1' } },
});

describe('update-labor-rate handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('recomputes offshoreFullyLoadedRate when the offshore buildup is patched in', async () => {
    // getLaborRate (GetCommand) → not found by laborRateId-as-position
    mockSend.mockResolvedValueOnce({ Item: undefined });
    // getLaborRatesByOrg (QueryCommand) → returns the existing rate
    mockSend.mockResolvedValueOnce({ Items: [existingRate] });
    // updateLaborRate (PutCommand)
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({
      laborRateId: RATE_ID,
      orgId: ORG_ID,
      offshoreBaseRate: 30,
      offshoreOverhead: 100,
      offshoreGa: 10,
      offshoreProfit: 10,
    });

    const result = await baseHandler(event as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    // 30 * 2 = 60 → 66 → 72.6
    expect(parsed.laborRate.offshoreFullyLoadedRate).toBe(72.6);
    // Onshore rate recomputed from the (unchanged) onshore buildup: 75 * 2.2 * 1.12 * 1.1
    expect(parsed.laborRate.fullyLoadedRate).toBe(203.28);
  });

  it('clears the offshore buildup when offshoreBaseRate is explicitly null', async () => {
    const rateWithOffshore = {
      ...existingRate,
      offshoreBaseRate: 30,
      offshoreOverhead: 100,
      offshoreGa: 10,
      offshoreProfit: 10,
      offshoreFullyLoadedRate: 72.6,
      offshoreRateJustification: 'India delivery center',
    };
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({ Items: [rateWithOffshore] });
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ laborRateId: RATE_ID, orgId: ORG_ID, offshoreBaseRate: null });

    const result = await baseHandler(event as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    // Entire offshore buildup wiped (undefined → dropped by putItem's removeUndefinedValues)
    expect(parsed.laborRate.offshoreFullyLoadedRate).toBeUndefined();
    expect(parsed.laborRate.offshoreBaseRate).toBeUndefined();
    expect(parsed.laborRate.offshoreOverhead).toBeUndefined();
    expect(parsed.laborRate.offshoreRateJustification).toBeUndefined();
    // Onshore rate untouched
    expect(parsed.laborRate.fullyLoadedRate).toBeGreaterThan(0);
  });

  it('preserves the offshore buildup when the update does not mention offshore fields', async () => {
    const rateWithOffshore = {
      ...existingRate,
      offshoreBaseRate: 30,
      offshoreOverhead: 100,
      offshoreGa: 10,
      offshoreProfit: 10,
      offshoreFullyLoadedRate: 72.6,
    };
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({ Items: [rateWithOffshore] });
    mockSend.mockResolvedValueOnce({});

    // Only touches an onshore field — offshore must survive.
    const event = makeEvent({ laborRateId: RATE_ID, orgId: ORG_ID, baseRate: 80 });

    const result = await baseHandler(event as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    expect(parsed.laborRate.offshoreFullyLoadedRate).toBe(72.6);
    expect(parsed.laborRate.offshoreBaseRate).toBe(30);
  });

  it('leaves offshoreFullyLoadedRate undefined when no offshore buildup exists', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({ Items: [existingRate] });
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ laborRateId: RATE_ID, orgId: ORG_ID, baseRate: 80 });

    const result = await baseHandler(event as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    expect(parsed.laborRate.offshoreFullyLoadedRate).toBeUndefined();
  });

  it('accepts a date-only effectiveDate on update (regression)', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({ Items: [existingRate] });
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({
      laborRateId: RATE_ID,
      orgId: ORG_ID,
      effectiveDate: '2026-08-05',
      offshoreBaseRate: 25,
    });

    const result = await baseHandler(event as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(200);
    expect(parsed.laborRate.effectiveDate).toBe('2026-08-05T00:00:00.000Z');
  });

  it('returns 404 when the labor rate is not found', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = makeEvent({ laborRateId: RATE_ID, orgId: ORG_ID, baseRate: 80 });

    const result = await baseHandler(event as never);
    expect((result as { statusCode: number }).statusCode).toBe(404);
  });
});
