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

const mockResolveStaffingPlanItems = jest.fn();
const mockCreateStaffingPlanRecord = jest.fn();
const mockResolveRateBasisForOpportunity = jest.fn();

jest.mock('@/helpers/pricing', () => ({
  resolveStaffingPlanItems: (...args: unknown[]) => mockResolveStaffingPlanItems(...args),
  createStaffingPlanRecord: (...args: unknown[]) => mockCreateStaffingPlanRecord(...args),
  resolveRateBasisForOpportunity: (...args: unknown[]) => mockResolveRateBasisForOpportunity(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './create-staffing-plan';

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

const validBody = {
  orgId: ORG_ID,
  projectId: PROJECT_ID,
  opportunityId: OPP_ID,
  name: 'Base Plan',
  laborItems: [{ position: 'Engineer', hours: 100 }],
};

describe('create-staffing-plan handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateStaffingPlanRecord.mockImplementation((plan) => Promise.resolve(plan));
    mockResolveStaffingPlanItems.mockResolvedValue({
      items: [{ position: 'Engineer', hours: 100, rate: 60, totalCost: 6000, rateBasis: 'OFFSHORE' }],
      totalLaborCost: 6000,
      fallbackPositions: [],
    });
  });

  it('derives OFFSHORE basis from the opportunity when the request omits rateBasis', async () => {
    mockResolveRateBasisForOpportunity.mockResolvedValue('OFFSHORE');

    const result = await baseHandler(makeEvent(validBody) as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(mockResolveRateBasisForOpportunity).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, OPP_ID);
    // basis passed as 3rd arg to resolveStaffingPlanItems
    expect(mockResolveStaffingPlanItems).toHaveBeenCalledWith(ORG_ID, validBody.laborItems, 'OFFSHORE');
    expect(parsed.rateBasis).toBe('OFFSHORE');
  });

  it('honors an explicit rateBasis override without consulting the opportunity', async () => {
    const result = await baseHandler(makeEvent({ ...validBody, rateBasis: 'ONSHORE' }) as never);

    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(mockResolveRateBasisForOpportunity).not.toHaveBeenCalled();
    expect(mockResolveStaffingPlanItems).toHaveBeenCalledWith(ORG_ID, validBody.laborItems, 'ONSHORE');
  });

  it('surfaces onshore fallback positions when offshore rates are missing', async () => {
    mockResolveRateBasisForOpportunity.mockResolvedValue('OFFSHORE');
    mockResolveStaffingPlanItems.mockResolvedValue({
      items: [{ position: 'Engineer', hours: 100, rate: 90, totalCost: 9000, rateBasis: 'ONSHORE' }],
      totalLaborCost: 9000,
      fallbackPositions: ['Engineer'],
    });

    const result = await baseHandler(makeEvent(validBody) as never);
    const parsed = JSON.parse(typeof result === 'string' ? result : (result as { body: string }).body);

    expect(parsed.onshoreFallbackPositions).toEqual(['Engineer']);
  });

  it('returns 400 when a position has no active rate', async () => {
    mockResolveRateBasisForOpportunity.mockResolvedValue('ONSHORE');
    mockResolveStaffingPlanItems.mockRejectedValue(new Error('No active labor rate found for position: Ghost'));

    const result = await baseHandler(makeEvent(validBody) as never);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 for invalid payload', async () => {
    const result = await baseHandler(makeEvent({ orgId: 'not-a-uuid' }) as never);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });
});
