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

const mockCreateReviewRun = jest.fn();
jest.mock('@/helpers/compliance-review', () => ({
  createReviewRun: (...a: unknown[]) => mockCreateReviewRun(...a),
}));

const mockBuildSnapshot = jest.fn();
jest.mock('@/helpers/compliance-review-snapshot', () => ({
  buildPackageSnapshot: (...a: unknown[]) => mockBuildSnapshot(...a),
}));

const mockEnqueue = jest.fn();
jest.mock('@/helpers/compliance-review-queue', () => ({
  enqueueComplianceReview: (...a: unknown[]) => mockEnqueue(...a),
}));

import { baseHandler } from './trigger-review';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const event = { queryStringParameters: query } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildSnapshot.mockResolvedValue({ 'doc:1': 'v1' });
});

describe('trigger-review handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await baseHandler({ queryStringParameters: {} } as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 404 when the opportunity is missing', async () => {
    mockGetOpportunity.mockResolvedValue(null);
    const res = await baseHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(404);
    expect(mockCreateReviewRun).not.toHaveBeenCalled();
  });

  it('returns 409 when a review is already running', async () => {
    mockGetOpportunity.mockResolvedValue({ oppId: 'opp-1' });
    mockCreateReviewRun.mockResolvedValue(null); // guard: active run exists
    const res = await baseHandler(event);
    expect((res as { statusCode: number }).statusCode).toBe(409);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('creates a run, enqueues, and returns 202 on the happy path', async () => {
    mockGetOpportunity.mockResolvedValue({ oppId: 'opp-1' });
    mockCreateReviewRun.mockResolvedValue({ reviewId: '22222222-2222-2222-2222-222222222222', status: 'RUNNING' });
    const res = await baseHandler(event) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toEqual({ reviewId: '22222222-2222-2222-2222-222222222222', status: 'RUNNING' });
    expect(mockEnqueue).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      reviewId: '22222222-2222-2222-2222-222222222222',
    });
  });

  it('snapshots the package before creating the run', async () => {
    mockGetOpportunity.mockResolvedValue({ oppId: 'opp-1' });
    mockCreateReviewRun.mockResolvedValue({ reviewId: '22222222-2222-2222-2222-222222222222', status: 'RUNNING' });
    await baseHandler(event);
    expect(mockBuildSnapshot).toHaveBeenCalled();
    expect(mockCreateReviewRun).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'FULL', snapshotVersionIds: { 'doc:1': 'v1' } }),
    );
  });
});
