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

const mockGetLatest = jest.fn();
const mockGetById = jest.fn();
const mockIsRunStale = jest.fn();
const mockMarkFailed = jest.fn();
jest.mock('@/helpers/package-edit', () => ({
  getLatestProposalRun: (...a: unknown[]) => mockGetLatest(...a),
  getProposalRunById: (...a: unknown[]) => mockGetById(...a),
  isRunStale: (...a: unknown[]) => mockIsRunStale(...a),
  markRunFailed: (...a: unknown[]) => mockMarkFailed(...a),
}));

const mockBuildSnapshot = jest.fn();
const mockIsSnapshotStale = jest.fn();
jest.mock('@/helpers/compliance-review-snapshot', () => ({
  buildPackageSnapshot: (...a: unknown[]) => mockBuildSnapshot(...a),
  isSnapshotStale: (...a: unknown[]) => mockIsSnapshotStale(...a),
}));

import { baseHandler } from './get-run';

const query = { orgId: 'o', projectId: 'p', opportunityId: 'opp' };
const makeEvent = (extra: Record<string, string> = {}) =>
  ({ queryStringParameters: { ...query, ...extra } }) as never;

const run = (over: Record<string, unknown> = {}) => ({
  runId: 'r1', orgId: 'o', projectId: 'p', oppId: 'opp',
  status: 'PROPOSED', instruction: 'x', proposals: [], snapshotVersionIds: {},
  startedAt: '2026-08-10T00:00:00.000Z', ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOpportunity.mockResolvedValue({ oppId: 'opp' });
  mockIsRunStale.mockReturnValue(false);
  mockBuildSnapshot.mockResolvedValue({});
  mockIsSnapshotStale.mockReturnValue(false);
});

describe('get-run handler', () => {
  it('returns 400 on missing query params', async () => {
    const res = await baseHandler({ queryStringParameters: {} } as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 404 when the opportunity is missing', async () => {
    mockGetOpportunity.mockResolvedValueOnce(null);
    const res = await baseHandler(makeEvent());
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('returns the latest run and a stale=false flag for a fresh PROPOSED run', async () => {
    mockGetLatest.mockResolvedValueOnce(run());
    const res = await baseHandler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.run.runId).toBe('r1');
    expect(body.stale).toBe(false);
  });

  it('W2: fetches a SPECIFIC run by runId (not latest) when the query provides one', async () => {
    mockGetById.mockResolvedValueOnce(run({ runId: 'r-specific' }));
    const res = await baseHandler(makeEvent({ runId: 'r-specific' }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.run.runId).toBe('r-specific');
    expect(mockGetById).toHaveBeenCalledWith('o', 'p', 'opp', 'r-specific');
    expect(mockGetLatest).not.toHaveBeenCalled();
  });

  it('marks a stale PROPOSING run as FAILED (crash recovery)', async () => {
    mockGetLatest.mockResolvedValueOnce(run({ status: 'PROPOSING' }));
    mockIsRunStale.mockReturnValueOnce(true);
    mockMarkFailed.mockResolvedValueOnce(run({ status: 'FAILED' }));

    const res = await baseHandler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(mockMarkFailed).toHaveBeenCalled();
    expect(body.run.status).toBe('FAILED');
  });

  it('reports stale=true when the package changed since a PROPOSED run', async () => {
    mockGetLatest.mockResolvedValueOnce(run());
    mockIsSnapshotStale.mockReturnValueOnce(true);
    const res = await baseHandler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.stale).toBe(true);
  });

  it('returns null run when none exists', async () => {
    mockGetLatest.mockResolvedValueOnce(null);
    const res = await baseHandler(makeEvent());
    const body = JSON.parse((res as { body: string }).body);
    expect(body.run).toBeNull();
    expect(body.stale).toBe(false);
  });
});
