jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/helpers/env', () => ({ requireEnv: (_k: string, d?: string) => d ?? 'test' }));

const mockRunFullReview = jest.fn();
jest.mock('@/helpers/compliance-review-engine', () => ({
  runFullReview: (...a: unknown[]) => mockRunFullReview(...a),
}));

const mockGetRun = jest.fn();
const mockMarkReady = jest.fn();
const mockMarkFailed = jest.fn();
jest.mock('@/helpers/compliance-review', () => ({
  getReviewRunById: (...a: unknown[]) => mockGetRun(...a),
  markRunReady: (...a: unknown[]) => mockMarkReady(...a),
  markRunFailed: (...a: unknown[]) => mockMarkFailed(...a),
}));

const mockAudit = jest.fn();
jest.mock('@/helpers/compliance-review-audit', () => ({
  writeComplianceAuditLog: (...a: unknown[]) => mockAudit(...a),
}));

import { handler } from './review-worker';

const JOB = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', reviewId: 'rev-1' };
const sqsEvent = (body: unknown) => ({ Records: [{ body: JSON.stringify(body) }] }) as never;
const RUNNING_RUN = { reviewId: 'rev-1', status: 'RUNNING', trigger: 'FULL' };

// Silence expected error/log noise from the failure-path test.
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRun.mockResolvedValue(RUNNING_RUN);
  mockMarkReady.mockResolvedValue(undefined);
  mockMarkFailed.mockResolvedValue(undefined);
  mockAudit.mockResolvedValue(undefined);
});

describe('review-worker handler', () => {
  it('drops a malformed job without touching the run', async () => {
    await handler(sqsEvent({ nope: true }), {} as never, () => {});
    expect(mockGetRun).not.toHaveBeenCalled();
    expect(mockRunFullReview).not.toHaveBeenCalled();
  });

  it('skips when the run is not found', async () => {
    mockGetRun.mockResolvedValue(null);
    await handler(sqsEvent(JOB), {} as never, () => {});
    expect(mockRunFullReview).not.toHaveBeenCalled();
  });

  it('skips a run that is no longer RUNNING (idempotent redelivery)', async () => {
    mockGetRun.mockResolvedValue({ ...RUNNING_RUN, status: 'READY' });
    await handler(sqsEvent(JOB), {} as never, () => {});
    expect(mockRunFullReview).not.toHaveBeenCalled();
  });

  it('runs the review, marks READY, and audits COMPLIANCE_REVIEW_COMPLETED', async () => {
    mockRunFullReview.mockResolvedValue({ findings: [{ findingId: 'f1' }, { findingId: 'f2' }] });
    await handler(sqsEvent(JOB), {} as never, () => {});

    expect(mockMarkReady).toHaveBeenCalledWith(RUNNING_RUN, [{ findingId: 'f1' }, { findingId: 'f2' }]);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMPLIANCE_REVIEW_COMPLETED',
        resource: 'compliance_review_run',
        resourceId: 'rev-1',
        orgId: 'org-1',
        after: expect.objectContaining({ findingsCount: 2 }),
      }),
    );
  });

  it('marks FAILED, audits COMPLIANCE_REVIEW_FAILED, and re-throws on engine error', async () => {
    mockRunFullReview.mockRejectedValue(new Error('bedrock exploded'));
    await expect(handler(sqsEvent(JOB), {} as never, () => {})).rejects.toThrow('bedrock exploded');

    expect(mockMarkFailed).toHaveBeenCalledWith(RUNNING_RUN, 'bedrock exploded');
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'COMPLIANCE_REVIEW_FAILED',
        resourceId: 'rev-1',
        result: 'failure',
        errorMessage: 'bedrock exploded',
      }),
    );
  });
});
