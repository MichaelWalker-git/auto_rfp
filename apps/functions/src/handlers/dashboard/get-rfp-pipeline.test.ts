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

const mockListOpportunitiesByOrg = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  listOpportunitiesByOrg: (...args: unknown[]) => mockListOpportunitiesByOrg(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './get-rfp-pipeline';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const makeEvent = (qs: Record<string, string | undefined>): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: qs,
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
    headers: {},
  }) as unknown as APIGatewayProxyEventV2;

describe('get-rfp-pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListOpportunitiesByOrg.mockResolvedValue({ items: [] });
    // Default: no server-side allowlist configured (backward-compat behavior).
    delete process.env.RFP_TRACKING_ORG_ID;
  });

  afterEach(() => {
    delete process.env.RFP_TRACKING_ORG_ID;
  });

  it('returns 400 when orgId is missing', async () => {
    const response = await baseHandler(makeEvent({}));
    expect(response).toMatchObject({ statusCode: 400 });
    expect(mockListOpportunitiesByOrg).not.toHaveBeenCalled();
  });

  it('scopes the fetch to the Linear-sync project on the happy path', async () => {
    const items = [
      { id: 'opp-1', title: 'A', status: 'QUALIFYING' },
      { id: 'opp-2', title: 'B', status: 'PURSUING' },
    ];
    mockListOpportunitiesByOrg.mockResolvedValueOnce({ items });

    const response = await baseHandler(makeEvent({ orgId: 'org-123' }));

    expect(mockListOpportunitiesByOrg).toHaveBeenCalledWith({
      orgId: 'org-123',
      projectId: 'gov-contracting',
    });
    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.ok).toBe(true);
    expect(body.items).toHaveLength(2);
  });

  it('honors an explicit projectId query-param override', async () => {
    mockListOpportunitiesByOrg.mockResolvedValueOnce({ items: [] });

    await baseHandler(makeEvent({ orgId: 'org-123', projectId: 'other-project' }));

    expect(mockListOpportunitiesByOrg).toHaveBeenCalledWith({
      orgId: 'org-123',
      projectId: 'other-project',
    });
  });

  it('returns 500 when the helper throws', async () => {
    mockListOpportunitiesByOrg.mockRejectedValueOnce(new Error('dynamo down'));
    const response = await baseHandler(makeEvent({ orgId: 'org-123' }));
    expect(response).toMatchObject({ statusCode: 500 });
  });

  describe('server-side org allowlist (RFP_TRACKING_ORG_ID)', () => {
    it('returns 404 for a mismatched orgId when the allowlist is set', async () => {
      process.env.RFP_TRACKING_ORG_ID = 'allowed-org';

      const response = await baseHandler(makeEvent({ orgId: 'attacker-org' }));

      expect(response).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body).toEqual({ ok: false, error: 'Not found' });
      // Must not leak the resource — the helper is never called.
      expect(mockListOpportunitiesByOrg).not.toHaveBeenCalled();
    });

    it('returns 200 for a matching orgId when the allowlist is set', async () => {
      process.env.RFP_TRACKING_ORG_ID = 'allowed-org';
      const items = [{ id: 'opp-1', title: 'A', status: 'QUALIFYING' }];
      mockListOpportunitiesByOrg.mockResolvedValueOnce({ items });

      const response = await baseHandler(makeEvent({ orgId: 'allowed-org' }));

      expect(response).toMatchObject({ statusCode: 200 });
      expect(mockListOpportunitiesByOrg).toHaveBeenCalledWith({
        orgId: 'allowed-org',
        projectId: 'gov-contracting',
      });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.ok).toBe(true);
      expect(body.items).toHaveLength(1);
    });

    it('does not block any org when the allowlist env var is unset', async () => {
      // RFP_TRACKING_ORG_ID is deleted in beforeEach — gate disabled.
      const response = await baseHandler(makeEvent({ orgId: 'any-org' }));

      expect(response).toMatchObject({ statusCode: 200 });
      expect(mockListOpportunitiesByOrg).toHaveBeenCalledWith({
        orgId: 'any-org',
        projectId: 'gov-contracting',
      });
    });
  });
});
