/**
 * Tests for the deterministic expired-deadline guard in exec-brief-worker.
 * The guard enforces the prompt's FINAL CONSISTENCY CHECK in post-processing:
 * an expired-deadline blocker MUST force the decision to NO_GO.
 */

// Env vars required at module load time
process.env.BEDROCK_MODEL_ID = 'test-model';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// Mock everything the worker imports with side effects
jest.mock('@/sentry-lambda', () => ({
  Sentry: { captureException: jest.fn(), withScope: jest.fn() },
  withSentryLambda: (h: unknown) => h,
  BusinessRetryError: class BusinessRetryError extends Error {},
}));
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  buildSectionInputHash: jest.fn(),
  computeOverallStatus: jest.fn(),
  getExecutiveBrief: jest.fn(),
  invokeClaudeJson: jest.fn(),
  loadSolicitationForBrief: jest.fn(),
  markSectionComplete: jest.fn(),
  markSectionFailed: jest.fn(),
  markSectionInProgress: jest.fn(),
  queryCompanyKnowledgeBase: jest.fn(),
  sanitizeSummaryResponse: jest.fn(),
  smartTruncate: jest.fn(),
  truncateText: jest.fn(),
}));
jest.mock('@/helpers/custom-document-types', () => ({
  syncRequiredDocumentsToCustomTypes: jest.fn(),
}));
jest.mock('@/helpers/google-drive-queue', () => ({ enqueueGoogleDriveSync: jest.fn() }));
jest.mock('@/helpers/project', () => ({ getProjectById: jest.fn() }));
jest.mock('@/helpers/opportunity', () => ({ getOpportunity: jest.fn() }));
jest.mock('@/helpers/s3', () => ({ loadTextFromS3: jest.fn() }));
jest.mock('@/helpers/deadlines', () => ({ storeDeadlinesSeparately: jest.fn() }));
jest.mock('@/helpers/bedrock-tool-loop', () => ({ invokeClaudeWithTools: jest.fn() }));
jest.mock('@/helpers/brief-tools', () => ({ BRIEF_TOOLS: [], executeBriefTool: jest.fn() }));
jest.mock('@/helpers/opportunity-status', () => ({ onBriefScoringComplete: jest.fn() }));
jest.mock('@/helpers/past-performance-matching', () => ({
  ensurePastPerformanceForScoring: jest.fn(),
}));

import { applyExpiredDeadlineGuard, isExpiredDeadlineBlocker } from './exec-brief-worker';

describe('isExpiredDeadlineBlocker', () => {
  it.each([
    'Submission deadline has passed',
    'Response deadline expired on 2026-03-20',
    'Proposal due date is in the past',
    'The closing date has already closed',
    'Deadline lapsed before review',
  ])('matches expired-deadline blocker: "%s"', (blocker) => {
    expect(isExpiredDeadlineBlocker(blocker)).toBe(true);
  });

  it.each([
    'Ineligible set-aside: 8(a) sole source',
    'Mandatory TS/SCI clearance unobtainable',
    'Tight deadline requires fast turnaround', // deadline mentioned but not expired
    'Company passed on similar bids before', // expiry word but no deadline
  ])('does not match non-expiry blocker: "%s"', (blocker) => {
    expect(isExpiredDeadlineBlocker(blocker)).toBe(false);
  });
});

describe('applyExpiredDeadlineGuard', () => {
  const baseScoring = {
    compositeScore: 2.3,
    decision: 'CONDITIONAL_GO',
    decisionRationale: 'Buildable software with moderate fit.',
    blockers: ['Submission deadline has passed'],
  };

  it('forces NO_GO when an expired-deadline blocker exists', () => {
    const result = applyExpiredDeadlineGuard(baseScoring);
    expect(result.decision).toBe('NO_GO');
  });

  it('appends the override note to the existing rationale', () => {
    const result = applyExpiredDeadlineGuard(baseScoring);
    expect(result.decisionRationale).toContain('Buildable software with moderate fit.');
    expect(result.decisionRationale).toContain('Deadline override');
    expect(result.decisionRationale).toContain('NO_GO');
  });

  it('does not change the composite score', () => {
    const result = applyExpiredDeadlineGuard(baseScoring);
    expect(result.compositeScore).toBe(2.3);
  });

  it('leaves the scoring untouched when decision is already NO_GO', () => {
    const scoring = { ...baseScoring, decision: 'NO_GO' };
    const result = applyExpiredDeadlineGuard(scoring);
    expect(result).toBe(scoring);
  });

  it('leaves the scoring untouched when no expired-deadline blocker exists', () => {
    const scoring = {
      ...baseScoring,
      blockers: ['Ineligible set-aside: 8(a) sole source'],
    };
    const result = applyExpiredDeadlineGuard(scoring);
    expect(result).toBe(scoring);
    expect(result.decision).toBe('CONDITIONAL_GO');
  });

  it('handles empty or missing blockers', () => {
    expect(applyExpiredDeadlineGuard({ ...baseScoring, blockers: [] }).decision).toBe(
      'CONDITIONAL_GO',
    );
    expect(applyExpiredDeadlineGuard({ ...baseScoring, blockers: null }).decision).toBe(
      'CONDITIONAL_GO',
    );
  });

  it('uses the override note alone when rationale is empty', () => {
    const result = applyExpiredDeadlineGuard({ ...baseScoring, decisionRationale: null });
    expect(result.decision).toBe('NO_GO');
    expect(result.decisionRationale).toMatch(/^Deadline override/);
  });
});
