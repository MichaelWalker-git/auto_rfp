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

const mockIsComplianceReviewEnabled = jest.fn();
jest.mock('@/helpers/compliance-review-access', () => ({
  isComplianceReviewEnabled: (...a: unknown[]) => mockIsComplianceReviewEnabled(...a),
}));

const mockGetLatestRun = jest.fn();
const mockIsRunStale = jest.fn();
const mockMarkFailed = jest.fn();
const mockListDecisions = jest.fn();
jest.mock('@/helpers/compliance-review', () => ({
  getLatestReviewRun: (...a: unknown[]) => mockGetLatestRun(...a),
  isRunStale: (...a: unknown[]) => mockIsRunStale(...a),
  markRunFailed: (...a: unknown[]) => mockMarkFailed(...a),
  listFindingDecisions: (...a: unknown[]) => mockListDecisions(...a),
}));

const mockBuildSnapshot = jest.fn();
const mockIsSnapshotStale = jest.fn();
jest.mock('@/helpers/compliance-review-snapshot', () => ({
  buildPackageSnapshot: (...a: unknown[]) => mockBuildSnapshot(...a),
  isSnapshotStale: (...a: unknown[]) => mockIsSnapshotStale(...a),
}));

import { baseHandler } from './get-review';

const event = { queryStringParameters: { orgId: 'o', projectId: 'p', opportunityId: 'opp' } } as never;

const readyRun = {
  reviewId: '11111111-1111-1111-1111-111111111111', orgId: 'o', projectId: 'p', oppId: 'opp',
  status: 'READY', trigger: 'FULL', startedAt: '2026-07-28T00:00:00.000Z',
  finishedAt: '2026-07-28T00:01:00.000Z', snapshotVersionIds: { 'doc:1': 'v1' }, findings: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOpportunity.mockResolvedValue({ oppId: 'opp' });
  mockIsComplianceReviewEnabled.mockResolvedValue(true);
  mockListDecisions.mockResolvedValue([]);
  mockIsRunStale.mockReturnValue(false);
});

describe('get-review handler', () => {
  it('returns 403 when compliance review is not enabled for the org', async () => {
    mockIsComplianceReviewEnabled.mockResolvedValue(false);
    const res = await baseHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(403);
    expect(mockGetOpportunity).not.toHaveBeenCalled();
  });

  it('returns 404 when the opportunity is missing', async () => {
    mockGetOpportunity.mockResolvedValue(null);
    const res = await baseHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns a null run when none exists', async () => {
    mockGetLatestRun.mockResolvedValue(null);
    const res = await baseHandler(event) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).run).toBeNull();
    expect(JSON.parse(res.body).stale).toBe(false);
  });

  it('marks a stale RUNNING run as FAILED (crash recovery)', async () => {
    const runningRun = { ...readyRun, status: 'RUNNING', finishedAt: undefined };
    mockGetLatestRun.mockResolvedValue(runningRun);
    mockIsRunStale.mockReturnValue(true);
    mockMarkFailed.mockResolvedValue({ ...runningRun, status: 'FAILED' });

    const res = await baseHandler(event) as { statusCode: number; body: string };
    expect(mockMarkFailed).toHaveBeenCalled();
    expect(JSON.parse(res.body).run.status).toBe('FAILED');
  });

  it('computes staleness for a READY run', async () => {
    mockGetLatestRun.mockResolvedValue(readyRun);
    mockBuildSnapshot.mockResolvedValue({ 'doc:1': 'v2' });
    mockIsSnapshotStale.mockReturnValue(true);

    const res = await baseHandler(event) as { statusCode: number; body: string };
    expect(mockBuildSnapshot).toHaveBeenCalled();
    expect(JSON.parse(res.body).stale).toBe(true);
  });

  it('does not compute staleness for a non-READY run', async () => {
    mockGetLatestRun.mockResolvedValue({ ...readyRun, status: 'RUNNING', finishedAt: undefined });
    const res = await baseHandler(event) as { statusCode: number; body: string };
    expect(mockBuildSnapshot).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).stale).toBe(false);
  });
});
