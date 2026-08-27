jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

const mockBuildFoiaDashboard = jest.fn();
jest.mock('@/helpers/foia-dashboard', () => ({
  buildFoiaDashboard: (...a: unknown[]) => mockBuildFoiaDashboard(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './get-foia-dashboard';

type AuthedEvent = APIGatewayProxyEventV2 & { auth?: { userId?: string } };

const event = (query: Record<string, string> | null): AuthedEvent =>
  ({ queryStringParameters: query, auth: { userId: 'user-1' } }) as unknown as AuthedEvent;

const emptyDashboard = {
  orgId: 'org-1',
  counts: { WON: 0, LOST: 0, NOT_PRESENT: 0, CANCELLED: 0 },
  pricing: [],
  pricingCoverage: { withPricing: 0, total: 0 },
  scores: [],
  documentCount: 0,
  sentCount: 0,
  responseOutcomeCounts: {},
  calculatedAt: '2026-08-13T21:00:00.000Z',
};

describe('get-foia-dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildFoiaDashboard.mockReset().mockResolvedValue(emptyDashboard);
  });

  it('returns the dashboard for the requested org', async () => {
    mockBuildFoiaDashboard.mockResolvedValue({
      ...emptyDashboard,
      counts: { WON: 1, LOST: 4, NOT_PRESENT: 1, CANCELLED: 2 },
    });

    const res = await baseHandler(event({ orgId: 'org-1' }));

    expect(res).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dashboard.counts).toEqual({ WON: 1, LOST: 4, NOT_PRESENT: 1, CANCELLED: 2 });
    expect(mockBuildFoiaDashboard).toHaveBeenCalledWith('org-1');
  });

  it('400s without an orgId', async () => {
    const res = await baseHandler(event({}));

    expect(res).toMatchObject({ statusCode: 400 });
    expect(mockBuildFoiaDashboard).not.toHaveBeenCalled();
  });

  it('400s when there are no query parameters at all', async () => {
    const res = await baseHandler(event(null));

    expect(res).toMatchObject({ statusCode: 400 });
    expect(mockBuildFoiaDashboard).not.toHaveBeenCalled();
  });

  it('returns zeroed counts for an empty org rather than an error', async () => {
    const res = await baseHandler(event({ orgId: 'org-empty' }));

    expect(res).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((res as { body: string }).body);
    expect(body.dashboard.counts).toEqual({ WON: 0, LOST: 0, NOT_PRESENT: 0, CANCELLED: 0 });
  });

  it('reads orgId from the query string, never from the auth context', async () => {
    // Convention: orgId comes from the request. A token-derived orgId would silently
    // scope a shared-table read to the wrong tenant.
    const authed = event({ orgId: 'org-requested' });
    (authed as unknown as { auth: { orgId: string } }).auth = { orgId: 'org-from-token' };

    await baseHandler(authed);

    expect(mockBuildFoiaDashboard).toHaveBeenCalledWith('org-requested');
  });
});
