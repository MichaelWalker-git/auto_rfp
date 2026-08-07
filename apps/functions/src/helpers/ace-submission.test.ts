const mockGetOpportunity = jest.fn();
const mockUpdateOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
  updateOpportunity: (...args: unknown[]) => mockUpdateOpportunity(...args),
}));

const mockSetAceStageLocal = jest.fn();
jest.mock('@/helpers/ace-stage', () => ({
  setAceStageLocal: (...args: unknown[]) => mockSetAceStageLocal(...args),
}));

// Low-level Partner Central ops — mocked so no SDK/network is touched.
const mockStartEngagement = jest.fn();
const mockGetTaskStatus = jest.fn();
const mockSubmit = jest.fn();
const mockGetReview = jest.fn();
const mockAdvanceStage = jest.fn();
jest.mock('@/helpers/apn-client', () => ({
  startEngagementFromOpportunity: (...a: unknown[]) => mockStartEngagement(...a),
  getEngagementTaskStatus: (...a: unknown[]) => mockGetTaskStatus(...a),
  submitOpportunityForReview: (...a: unknown[]) => mockSubmit(...a),
  getOpportunityReviewSnapshot: (...a: unknown[]) => mockGetReview(...a),
  advanceOpportunityStage: (...a: unknown[]) => mockAdvanceStage(...a),
}));

jest.mock('@/helpers/date', () => ({
  nowIso: () => '2026-08-06T12:00:00.000Z',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { startAceSubmission, stepAceSubmission, isAceSubmissionEnabled } from './ace-submission';
import type { AceSubmission, OpportunityItem } from '@auto-rfp/core';

const ids = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

const baseItem = (over: Partial<OpportunityItem> = {}): Partial<OpportunityItem> => ({
  oppId: 'opp-1',
  id: 'opp-1',
  title: 'Cloud Migration RFP',
  organizationName: 'City of Springfield',
  baseAndAllOptionsValue: 250000,
  responseDeadlineIso: '2026-09-01T00:00:00Z',
  apnOpportunityId: 'O123',
  ...over,
});

const enable = () => { process.env.ACE_SUBMISSION_ENABLED = 'true'; };

/** Capture the patch written by the last updateOpportunity call. */
const lastPatch = (): { aceSubmission: AceSubmission } =>
  mockUpdateOpportunity.mock.calls[mockUpdateOpportunity.mock.calls.length - 1][0].patch;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ACE_SUBMISSION_ENABLED;
  delete process.env.APN_SUBMISSION_CATALOG;
  mockUpdateOpportunity.mockResolvedValue({ item: {} });
});

describe('isAceSubmissionEnabled', () => {
  it('is false unless the flag is exactly "true"', () => {
    expect(isAceSubmissionEnabled()).toBe(false);
    process.env.ACE_SUBMISSION_ENABLED = 'false';
    expect(isAceSubmissionEnabled()).toBe(false);
    process.env.ACE_SUBMISSION_ENABLED = '1';
    expect(isAceSubmissionEnabled()).toBe(false);
    process.env.ACE_SUBMISSION_ENABLED = 'true';
    expect(isAceSubmissionEnabled()).toBe(true);
  });
});

describe('feature flag gating', () => {
  it('startAceSubmission is a disabled no-op when flag is off', async () => {
    await expect(startAceSubmission(ids)).resolves.toBe('disabled');
    expect(mockGetOpportunity).not.toHaveBeenCalled();
  });

  it('stepAceSubmission is a disabled no-op when flag is off', async () => {
    await expect(stepAceSubmission(ids)).resolves.toBe('disabled');
    expect(mockGetOpportunity).not.toHaveBeenCalled();
  });
});

describe('startAceSubmission', () => {
  beforeEach(enable);

  it("returns 'not-found' when the opportunity is missing", async () => {
    mockGetOpportunity.mockResolvedValue(null);
    await expect(startAceSubmission(ids)).resolves.toBe('not-found');
  });

  it("returns 'no-apn-id' when there is no Partner Central id yet", async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ apnOpportunityId: undefined }) });
    await expect(startAceSubmission(ids)).resolves.toBe('no-apn-id');
    expect(mockStartEngagement).not.toHaveBeenCalled();
  });

  it('fires StartEngagementFromOpportunityTask and records ENGAGEMENT_PENDING', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem() });
    mockStartEngagement.mockResolvedValue({ taskId: 'oit-abc', taskStatus: 'IN_PROGRESS' });

    const outcome = await startAceSubmission(ids);

    expect(outcome).toBe('ENGAGEMENT_PENDING');
    expect(mockStartEngagement).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', oppId: 'opp-1', apnOpportunityId: 'O123' }),
    );
    expect(lastPatch().aceSubmission).toMatchObject({
      state: 'ENGAGEMENT_PENDING',
      taskId: 'oit-abc',
      attempts: 0,
    });
  });

  it('jumps straight to ENGAGED when the task completes synchronously', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem() });
    mockStartEngagement.mockResolvedValue({ taskId: 'oit-abc', taskStatus: 'COMPLETE', engagementId: 'eng-1' });

    await expect(startAceSubmission(ids)).resolves.toBe('ENGAGED');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'ENGAGED', engagementId: 'eng-1' });
  });

  it('is idempotent — leaves an already in-flight submission alone', async () => {
    mockGetOpportunity.mockResolvedValue({
      item: baseItem({ aceSubmission: { state: 'SUBMITTED' } }),
    });
    await expect(startAceSubmission(ids)).resolves.toBe('SUBMITTED');
    expect(mockStartEngagement).not.toHaveBeenCalled();
  });

  it('never throws — records a recoverable NONE on API error', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem() });
    mockStartEngagement.mockRejectedValue(new Error('AccessDenied'));

    await expect(startAceSubmission(ids)).resolves.toBe('noop');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'NONE', error: 'AccessDenied' });
  });
});

describe('stepAceSubmission — lifecycle walk', () => {
  beforeEach(enable);

  it('starts the pipeline when nothing has begun', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: { state: 'NONE' } }) });
    mockStartEngagement.mockResolvedValue({ taskId: 'oit-1', taskStatus: 'IN_PROGRESS' });

    await expect(stepAceSubmission(ids)).resolves.toBe('ENGAGEMENT_PENDING');
    expect(mockStartEngagement).toHaveBeenCalledTimes(1);
  });

  it('ENGAGEMENT_PENDING → ENGAGED when the task completes', async () => {
    mockGetOpportunity.mockResolvedValue({
      item: baseItem({ aceSubmission: { state: 'ENGAGEMENT_PENDING', taskId: 'oit-1' } }),
    });
    mockGetTaskStatus.mockResolvedValue({ taskStatus: 'COMPLETE', engagementId: 'eng-9' });

    await expect(stepAceSubmission(ids)).resolves.toBe('ENGAGED');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'ENGAGED', engagementId: 'eng-9' });
  });

  it('ENGAGEMENT_PENDING stays pending while task IN_PROGRESS (attempts increment)', async () => {
    mockGetOpportunity.mockResolvedValue({
      item: baseItem({ aceSubmission: { state: 'ENGAGEMENT_PENDING', taskId: 'oit-1', attempts: 2 } }),
    });
    mockGetTaskStatus.mockResolvedValue({ taskStatus: 'IN_PROGRESS' });

    await expect(stepAceSubmission(ids)).resolves.toBe('ENGAGEMENT_PENDING');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'ENGAGEMENT_PENDING', attempts: 3 });
  });

  it('ENGAGEMENT_PENDING → FAILED when the task fails (terminal)', async () => {
    mockGetOpportunity.mockResolvedValue({
      item: baseItem({ aceSubmission: { state: 'ENGAGEMENT_PENDING', taskId: 'oit-1' } }),
    });
    mockGetTaskStatus.mockResolvedValue({ taskStatus: 'FAILED', message: 'bad opp' });

    await expect(stepAceSubmission(ids)).resolves.toBe('FAILED');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'FAILED', error: 'bad opp' });
  });

  it('ENGAGED → SUBMITTED calls SubmitOpportunity', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: { state: 'ENGAGED' } }) });

    await expect(stepAceSubmission(ids)).resolves.toBe('SUBMITTED');
    expect(mockSubmit).toHaveBeenCalledWith({ apnOpportunityId: 'O123' });
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'SUBMITTED' });
  });

  it('SUBMITTED → IN_REVIEW as AWS starts validating', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: { state: 'SUBMITTED' } }) });
    mockGetReview.mockResolvedValue({ reviewStatus: 'In review' });

    await expect(stepAceSubmission(ids)).resolves.toBe('IN_REVIEW');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'IN_REVIEW', reviewStatus: 'In review' });
  });

  it('IN_REVIEW → APPROVED when AWS approves', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: { state: 'IN_REVIEW' } }) });
    mockGetReview.mockResolvedValue({ reviewStatus: 'Approved' });

    await expect(stepAceSubmission(ids)).resolves.toBe('APPROVED');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'APPROVED' });
  });

  it('IN_REVIEW → REJECTED (terminal) captures comments', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: { state: 'IN_REVIEW' } }) });
    mockGetReview.mockResolvedValue({ reviewStatus: 'Rejected', reviewStatusReason: 'not a fit' });

    await expect(stepAceSubmission(ids)).resolves.toBe('REJECTED');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'REJECTED', reviewComments: 'not a fit' });
  });

  it('IN_REVIEW → ACTION_REQUIRED pauses for a human', async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: { state: 'SUBMITTED' } }) });
    mockGetReview.mockResolvedValue({ reviewStatus: 'Action Required', reviewComments: 'add address' });

    await expect(stepAceSubmission(ids)).resolves.toBe('ACTION_REQUIRED');
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'ACTION_REQUIRED', reviewComments: 'add address' });
  });

  it('APPROVED → ADVANCED updates the PC stage and local ACE stage', async () => {
    mockGetOpportunity.mockResolvedValue({
      item: baseItem({ aceSubmission: { state: 'APPROVED' }, aceStage: 'Prospect' }),
    });

    await expect(stepAceSubmission(ids)).resolves.toBe('ADVANCED');
    expect(mockAdvanceStage).toHaveBeenCalledWith(
      expect.objectContaining({ apnOpportunityId: 'O123', aceStage: 'Technical Validation' }),
    );
    expect(mockSetAceStageLocal).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'Technical Validation', source: 'AUTO_SUBMITTED', changedBy: 'system' }),
    );
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'ADVANCED' });
  });

  it('APPROVED → ADVANCED does not re-append local history when already at stage', async () => {
    mockGetOpportunity.mockResolvedValue({
      item: baseItem({ aceSubmission: { state: 'APPROVED' }, aceStage: 'Technical Validation' }),
    });

    await expect(stepAceSubmission(ids)).resolves.toBe('ADVANCED');
    expect(mockAdvanceStage).toHaveBeenCalledTimes(1);
    expect(mockSetAceStageLocal).not.toHaveBeenCalled();
  });
});

describe('stepAceSubmission — guards & resilience', () => {
  beforeEach(enable);

  it("returns 'noop' for terminal ADVANCED", async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: { state: 'ADVANCED' } }) });
    await expect(stepAceSubmission(ids)).resolves.toBe('noop');
    expect(mockAdvanceStage).not.toHaveBeenCalled();
  });

  it("returns 'noop' for paused ACTION_REQUIRED (waits for a human)", async () => {
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: { state: 'ACTION_REQUIRED' } }) });
    await expect(stepAceSubmission(ids)).resolves.toBe('noop');
    expect(mockGetReview).not.toHaveBeenCalled();
  });

  it('never throws on a transient API error — records error, keeps state, bumps attempts', async () => {
    const prior = { state: 'SUBMITTED' as const, attempts: 1 };
    mockGetOpportunity.mockResolvedValue({ item: baseItem({ aceSubmission: prior }) });
    mockGetReview.mockRejectedValue(new Error('Throttling'));

    await expect(stepAceSubmission(ids)).resolves.toBe('noop');
    // Error recorded against the SAME state (not flipped to FAILED), attempts bumped.
    expect(lastPatch().aceSubmission).toMatchObject({ state: 'SUBMITTED', error: 'Throttling', attempts: 2 });
  });

  it('re-starts engagement when ENGAGEMENT_PENDING has no taskId', async () => {
    mockGetOpportunity.mockResolvedValue({
      item: baseItem({ aceSubmission: { state: 'ENGAGEMENT_PENDING' } }),
    });
    mockStartEngagement.mockResolvedValue({ taskId: 'oit-new', taskStatus: 'IN_PROGRESS' });

    await expect(stepAceSubmission(ids)).resolves.toBe('ENGAGEMENT_PENDING');
    expect(mockStartEngagement).toHaveBeenCalledTimes(1);
  });
});
