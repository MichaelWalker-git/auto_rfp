jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({ getOpportunity: (...a: unknown[]) => mockGetOpportunity(...a) }));

const mockUpsert = jest.fn();
const mockClear = jest.fn();
jest.mock('@/helpers/compliance-review', () => ({
  upsertFindingDecision: (...a: unknown[]) => mockUpsert(...a),
  clearFindingDecision: (...a: unknown[]) => mockClear(...a),
}));

const mockAudit = jest.fn();
jest.mock('@/helpers/compliance-review-audit', () => ({
  writeComplianceAuditLog: (...a: unknown[]) => mockAudit(...a),
}));

import { baseHandler } from './update-decision';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const makeEvent = (body: unknown) =>
  ({
    queryStringParameters: query,
    body: JSON.stringify(body),
    auth: { userId: 'user-9', claims: { email: 'jane@x.com' } },
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: { 'user-agent': 'jest' },
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOpportunity.mockResolvedValue({ oppId: 'opp-1' });
  mockUpsert.mockResolvedValue({ fingerprint: 'fp-1', state: 'dismissed' });
  mockClear.mockResolvedValue(undefined);
  mockAudit.mockResolvedValue(undefined);
});

describe('update-decision handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await baseHandler({ queryStringParameters: {}, body: '{}' } as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when the body is invalid', async () => {
    const res = await baseHandler(makeEvent({ nope: true }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 404 when the opportunity is missing', async () => {
    mockGetOpportunity.mockResolvedValue(null);
    const res = await baseHandler(makeEvent({ fingerprint: 'fp-1', state: 'dismissed' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('upserts a dismiss decision and returns it', async () => {
    const res = (await baseHandler(makeEvent({ fingerprint: 'fp-1', state: 'dismissed' }))) as {
      statusCode: number;
      body: string;
    };
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, decision: { fingerprint: 'fp-1', state: 'dismissed' } });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: 'fp-1', state: 'dismissed', decidedBy: 'user-9' }),
    );
  });

  it('audits a dismiss with COMPLIANCE_FINDING_DISMISSED', async () => {
    await baseHandler(makeEvent({ fingerprint: 'fp-1', state: 'dismissed' }));
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMPLIANCE_FINDING_DISMISSED',
        resource: 'compliance_review_finding',
        resourceId: 'fp-1',
        userId: 'user-9',
      }),
    );
  });

  it('audits a resolve with COMPLIANCE_FINDING_RESOLVED', async () => {
    mockUpsert.mockResolvedValue({ fingerprint: 'fp-1', state: 'resolved' });
    await baseHandler(makeEvent({ fingerprint: 'fp-1', state: 'resolved' }));
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COMPLIANCE_FINDING_RESOLVED', resourceId: 'fp-1' }),
    );
  });

  it('clears a decision (null state) and audits COMPLIANCE_FINDING_DECISION_CLEARED', async () => {
    const res = (await baseHandler(makeEvent({ fingerprint: 'fp-1', state: null }))) as {
      statusCode: number;
      body: string;
    };
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, decision: null });
    expect(mockClear).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: 'fp-1', orgId: 'org-1' }),
    );
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'COMPLIANCE_FINDING_DECISION_CLEARED', resourceId: 'fp-1' }),
    );
  });
});
