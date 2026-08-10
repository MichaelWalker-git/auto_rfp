jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const mockGetLaborRatesByOrg = jest.fn();
const mockCreateCostEstimate = jest.fn();
const mockResolveRateBasisForOpportunity = jest.fn();

// Use the real resolveRate / calculateEstimateTotals so fallback logic is exercised end-to-end.
jest.mock('@/helpers/pricing', () => {
  const actual = jest.requireActual('@/helpers/pricing');
  return {
    ...actual,
    getLaborRatesByOrg: (...args: unknown[]) => mockGetLaborRatesByOrg(...args),
    getBOMItemsByOrg: jest.fn(() => Promise.resolve([])),
    createCostEstimate: (...args: unknown[]) => mockCreateCostEstimate(...args),
    resolveRateBasisForOpportunity: (...args: unknown[]) => mockResolveRateBasisForOpportunity(...args),
  };
});

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './calculate-estimate';

const ORG_ID = '550e8400-e29b-41d4-a716-446655440000';
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440010';
const OPP_ID = '550e8400-e29b-41d4-a716-446655440020';

const makeEvent = (body: Record<string, unknown>) => ({
  body: JSON.stringify(body),
  auth: { userId: 'user-123', userName: 'test-user' },
  queryStringParameters: {},
  headers: {},
  requestContext: { http: { sourceIp: '127.0.0.1' } },
});

const baseRate = (over: Record<string, unknown> = {}) => ({
  laborRateId: '11111111-1111-1111-1111-111111111111',
  orgId: ORG_ID,
  position: 'Engineer',
  baseRate: 100,
  overhead: 0,
  ga: 0,
  profit: 0,
  fullyLoadedRate: 100,
  isActive: true,
  effectiveDate: '2024-01-01T00:00:00.000Z',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  createdBy: '22222222-2222-2222-2222-222222222222',
  updatedBy: '22222222-2222-2222-2222-222222222222',
  ...over,
});

const validBody = {
  orgId: ORG_ID,
  projectId: PROJECT_ID,
  opportunityId: OPP_ID,
  strategy: 'FIXED_PRICE',
  laborItems: [{ position: 'Engineer', hours: 100 }],
};

describe('calculate-estimate handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateCostEstimate.mockImplementation((est) => Promise.resolve(est));
    mockResolveRateBasisForOpportunity.mockResolvedValue('ONSHORE');
  });

  it('prices offshore and reports no fallback when an offshore rate exists', async () => {
    mockGetLaborRatesByOrg.mockResolvedValue([baseRate({ offshoreFullyLoadedRate: 60 })]);

    const result = await baseHandler(makeEvent({ ...validBody, rateBasis: 'OFFSHORE' }) as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(parsed.rateBasis).toBe('OFFSHORE');
    expect(parsed.onshoreFallbackPositions).toBeUndefined();
    expect(parsed.estimate.laborCosts[0].unitCost).toBe(60);
    expect(parsed.estimate.laborCosts[0].rateBasis).toBe('OFFSHORE');
  });

  it('surfaces onshoreFallbackPositions when offshore requested but no offshore rate exists', async () => {
    mockGetLaborRatesByOrg.mockResolvedValue([baseRate()]); // no offshore rate

    const result = await baseHandler(makeEvent({ ...validBody, rateBasis: 'OFFSHORE' }) as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(parsed.onshoreFallbackPositions).toEqual(['Engineer']);
    expect(parsed.estimate.laborCosts[0].unitCost).toBe(100); // fell back to onshore
    expect(parsed.estimate.laborCosts[0].rateBasis).toBe('ONSHORE');
  });

  it('derives the basis from the opportunity when the request omits rateBasis', async () => {
    mockResolveRateBasisForOpportunity.mockResolvedValue('OFFSHORE');
    mockGetLaborRatesByOrg.mockResolvedValue([baseRate({ offshoreFullyLoadedRate: 60 })]);

    const result = await baseHandler(makeEvent(validBody) as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect(mockResolveRateBasisForOpportunity).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, OPP_ID);
    expect(parsed.rateBasis).toBe('OFFSHORE');
    expect(parsed.estimate.laborCosts[0].unitCost).toBe(60);
  });

  it('returns 400 for invalid payload', async () => {
    const result = await baseHandler(makeEvent({ orgId: 'not-a-uuid' }) as never);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });
});
