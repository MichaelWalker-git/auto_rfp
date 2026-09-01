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
  scanDeliveryLocationConstraint: jest.fn(),
  scanPhysicalSubmission: jest.fn(),
  smartTruncate: jest.fn(),
  truncateText: jest.fn(),
}));
jest.mock('@/helpers/custom-document-types', () => ({
  syncRequiredDocumentsToCustomTypes: jest.fn(),
}));
jest.mock('@/helpers/google-drive-queue', () => ({ enqueueGoogleDriveSync: jest.fn() }));
jest.mock('@/helpers/project', () => ({ getProjectById: jest.fn() }));
jest.mock('@/helpers/opportunity', () => ({ getOpportunity: jest.fn(), updateOpportunity: jest.fn() }));
jest.mock('@/helpers/linear', () => ({ syncPhysicalSubmissionLabel: jest.fn() }));
jest.mock('@/helpers/s3', () => ({ loadTextFromS3: jest.fn() }));
jest.mock('@/helpers/deadlines', () => ({ storeDeadlinesSeparately: jest.fn() }));
jest.mock('@/helpers/bedrock-tool-loop', () => ({ invokeClaudeWithTools: jest.fn() }));
jest.mock('@/helpers/brief-tools', () => ({ BRIEF_TOOLS: [], executeBriefTool: jest.fn() }));
jest.mock('@/helpers/opportunity-status', () => ({ onBriefScoringComplete: jest.fn() }));
jest.mock('@/helpers/past-performance-matching', () => ({
  ensurePastPerformanceForScoring: jest.fn(),
}));
jest.mock('@/constants/prompt', () => ({
  getSummarySystemPrompt: jest.fn(),
  useContactsSystemPrompt: jest.fn(),
  useContactsUserPrompt: jest.fn(),
  useDeadlineSystemPrompt: jest.fn(),
  useDeadlineUserPrompt: jest.fn(),
  useRequirementsSystemPrompt: jest.fn(),
  useRequirementsUserPrompt: jest.fn(),
  useRiskSystemPrompt: jest.fn(),
  useRiskUserPrompt: jest.fn(),
  useScoringSystemPrompt: jest.fn(),
  useScoringUserPrompt: jest.fn(),
  useSummaryUserPrompt: jest.fn(),
}));

import { applyExpiredDeadlineGuard, isExpiredDeadlineBlocker, runSummary } from './exec-brief-worker';
import {
  getExecutiveBrief,
  invokeClaudeJson,
  loadSolicitationForBrief,
  markSectionFailed,
  scanDeliveryLocationConstraint,
  scanPhysicalSubmission,
  smartTruncate,
} from '@/helpers/executive-opportunity-brief';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';
import { syncPhysicalSubmissionLabel } from '@/helpers/linear';

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

describe('runSummary — physical submission detection', () => {
  const RAW_TEXT = 'Proposals must be mailed to the address below. Certified mail preferred.';

  const baseJob = {
    orgId: 'org-1',
    executiveBriefId: 'brief-1',
    section: 'summary' as const,
    inputHash: 'hash-1',
    retryCount: 0,
  };

  const baseBrief = {
    projectId: 'project-1',
    opportunityId: 'opp-1',
    allTextKeys: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getExecutiveBrief as jest.Mock).mockResolvedValue(baseBrief);
    (loadSolicitationForBrief as jest.Mock).mockResolvedValue({
      solicitationText: RAW_TEXT,
      textKeys: ['key-1'],
    });
    (smartTruncate as jest.Mock).mockImplementation((text: string) => text);
    (invokeClaudeJson as jest.Mock).mockResolvedValue({});
    (scanDeliveryLocationConstraint as jest.Mock).mockReturnValue(null);
    (scanPhysicalSubmission as jest.Mock).mockReturnValue(null);
    (getOpportunity as jest.Mock).mockResolvedValue({ item: {} });
    (updateOpportunity as jest.Mock).mockResolvedValue(undefined);
    (syncPhysicalSubmissionLabel as jest.Mock).mockResolvedValue(undefined);
  });

  it('calls the scanner with the raw solicitation text', async () => {
    await runSummary(baseJob);

    expect(scanPhysicalSubmission).toHaveBeenCalledWith(RAW_TEXT);
  });

  it('persists the detection result on the opportunity', async () => {
    (scanPhysicalSubmission as jest.Mock).mockReturnValue({
      submissionMethod: 'PHYSICAL',
      submissionMailingAddress: null,
      submissionMethodRationale: 'mail proposals to the address below',
    });

    await runSummary(baseJob);

    expect(updateOpportunity).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      oppId: 'opp-1',
      patch: {
        submissionMethod: 'PHYSICAL',
        submissionMailingAddress: null,
        submissionMethodRationale: 'mail proposals to the address below',
      },
    });
  });

  it('auto-fills the FOIA contact address when an address is present and the field is empty', async () => {
    (getOpportunity as jest.Mock).mockResolvedValue({ item: { foiaContactAddress: null } });
    (scanPhysicalSubmission as jest.Mock).mockReturnValue({
      submissionMethod: 'PHYSICAL',
      submissionMailingAddress: {
        addressLine1: '123 Main St',
        locality: 'Arlington',
        administrativeArea: 'VA',
        postalCode: '22201',
      },
      submissionMethodRationale: 'mail proposals to the address below',
    });

    await runSummary(baseJob);

    expect(updateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          foiaContactAddress: '123 Main St, Arlington, VA 22201',
        }),
      }),
    );
  });

  it('does not overwrite an existing FOIA contact address', async () => {
    (getOpportunity as jest.Mock).mockResolvedValue({ item: { foiaContactAddress: '456 Existing Ave' } });
    (scanPhysicalSubmission as jest.Mock).mockReturnValue({
      submissionMethod: 'PHYSICAL',
      submissionMailingAddress: {
        addressLine1: '123 Main St',
        locality: 'Arlington',
        administrativeArea: 'VA',
        postalCode: '22201',
      },
      submissionMethodRationale: 'mail proposals to the address below',
    });

    await runSummary(baseJob);

    const patch = (updateOpportunity as jest.Mock).mock.calls[0][0].patch;
    expect(patch).not.toHaveProperty('foiaContactAddress');
  });

  it('does not fail the brief when the scanner throws', async () => {
    (scanPhysicalSubmission as jest.Mock).mockImplementation(() => {
      throw new Error('scanner exploded');
    });

    await expect(runSummary(baseJob)).resolves.toBeUndefined();
    expect(markSectionFailed).not.toHaveBeenCalled();
    expect(updateOpportunity).not.toHaveBeenCalled();
  });

  it('syncs the Linear label with submissionMethod ELECTRONIC when detection is ELECTRONIC', async () => {
    (getOpportunity as jest.Mock).mockResolvedValue({ item: { noticeId: 'HOR-42' } });
    (scanPhysicalSubmission as jest.Mock).mockReturnValue({
      submissionMethod: 'ELECTRONIC',
      submissionMailingAddress: null,
      submissionMethodRationale: 'submit electronically via the portal',
    });

    await runSummary(baseJob);

    expect(syncPhysicalSubmissionLabel).toHaveBeenCalledWith('opp-1', 'HOR-42', 'ELECTRONIC');
  });

  it('syncs the Linear label with submissionMethod BOTH when detection is BOTH', async () => {
    (getOpportunity as jest.Mock).mockResolvedValue({ item: { noticeId: 'HOR-42' } });
    (scanPhysicalSubmission as jest.Mock).mockReturnValue({
      submissionMethod: 'BOTH',
      submissionMailingAddress: null,
      submissionMethodRationale: 'mail or submit electronically',
    });

    await runSummary(baseJob);

    expect(syncPhysicalSubmissionLabel).toHaveBeenCalledWith('opp-1', 'HOR-42', 'BOTH');
  });

  it('falls back to the LLM-extracted submissionMethod when the deterministic scan returns null', async () => {
    (scanPhysicalSubmission as jest.Mock).mockReturnValue(null);
    (invokeClaudeJson as jest.Mock).mockResolvedValue({
      summary: 'x',
      submissionMethod: 'PHYSICAL',
      submissionMethodRationale: 'LLM found mailing instructions',
    });

    await runSummary(baseJob);

    expect(updateOpportunity).toHaveBeenCalledWith({
      orgId: 'org-1',
      projectId: 'project-1',
      oppId: 'opp-1',
      patch: {
        submissionMethod: 'PHYSICAL',
        submissionMailingAddress: null,
        submissionMethodRationale: 'LLM found mailing instructions',
      },
    });
  });

  it('prefers the deterministic scan over the LLM fallback when both are present', async () => {
    (scanPhysicalSubmission as jest.Mock).mockReturnValue({
      submissionMethod: 'ELECTRONIC',
      submissionMailingAddress: null,
      submissionMethodRationale: 'scan rationale',
    });
    (invokeClaudeJson as jest.Mock).mockResolvedValue({
      summary: 'x',
      submissionMethod: 'PHYSICAL',
      submissionMethodRationale: 'llm rationale',
    });

    await runSummary(baseJob);

    expect(updateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          submissionMethod: 'ELECTRONIC',
          submissionMethodRationale: 'scan rationale',
        }),
      }),
    );
  });

  it('ignores an invalid LLM submissionMethod value when the scan returns null', async () => {
    (scanPhysicalSubmission as jest.Mock).mockReturnValue(null);
    (invokeClaudeJson as jest.Mock).mockResolvedValue({
      summary: 'x',
      submissionMethod: 'NOT_A_REAL_VALUE',
    });

    await runSummary(baseJob);

    expect(updateOpportunity).not.toHaveBeenCalled();
  });
});
