/**
 * Tests for `loadSolicitationBundle` (docs/SOLICITATION-COVERAGE-PLAN.md,
 * "Wiring"): routes between FULL and SUMMARIZED based on total merged raw
 * text size vs. the threshold, and only when the hybrid flag is enabled.
 */
const mockLoadRawSolicitationDocuments = jest.fn();
const mockApplyPerDocumentBudget = jest.fn();
const mockMergeSolicitationDocuments = jest.fn();
const mockSummarizeSolicitationDocument = jest.fn();
const mockUpdateQuestionFile = jest.fn();

jest.mock('@/helpers/executive-opportunity-brief', () => ({
  loadRawSolicitationDocuments: (...a: unknown[]) => mockLoadRawSolicitationDocuments(...a),
  applyPerDocumentBudget: (...a: unknown[]) => mockApplyPerDocumentBudget(...a),
  mergeSolicitationDocuments: (...a: unknown[]) => mockMergeSolicitationDocuments(...a),
}));

jest.mock('@/helpers/solicitation-summary', () => ({
  summarizeSolicitationDocument: (...a: unknown[]) => mockSummarizeSolicitationDocument(...a),
}));

jest.mock('@/helpers/questionFile', () => ({
  updateQuestionFile: (...a: unknown[]) => mockUpdateQuestionFile(...a),
}));

import { loadSolicitationBundle, resolveFullSolicitationThresholdChars } from './solicitation-loader';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...ORIGINAL_ENV };
  mockUpdateQuestionFile.mockResolvedValue({ success: true });
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('resolveFullSolicitationThresholdChars', () => {
  it('defaults to 150,000', () => {
    delete process.env.SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS;
    expect(resolveFullSolicitationThresholdChars()).toBe(150_000);
  });

  it('reads the env override', () => {
    process.env.SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS = '50000';
    expect(resolveFullSolicitationThresholdChars()).toBe(50_000);
  });

  it('falls back to the default for invalid values', () => {
    process.env.SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS = 'not-a-number';
    expect(resolveFullSolicitationThresholdChars()).toBe(150_000);
  });
});

describe('loadSolicitationBundle', () => {
  it('returns an empty FULL bundle when there are no documents', async () => {
    mockLoadRawSolicitationDocuments.mockResolvedValue([]);

    const bundle = await loadSolicitationBundle('proj-1', 'opp-1', 'org-1');

    expect(bundle).toEqual({ strategy: 'FULL', text: '', documents: [] });
    expect(mockApplyPerDocumentBudget).not.toHaveBeenCalled();
  });

  it('returns FULL when under the threshold, budget-floored and merged', async () => {
    const docs = [
      { file: {}, fileName: 'RFP.pdf', text: 'x'.repeat(1_000) },
      { file: {}, fileName: 'Attachment.pdf', text: 'y'.repeat(500) },
    ];
    mockLoadRawSolicitationDocuments.mockResolvedValue(docs);
    mockApplyPerDocumentBudget.mockReturnValue([
      { fileName: 'RFP.pdf', text: 'x'.repeat(1_000), trimmedBy: 0 },
      { fileName: 'Attachment.pdf', text: 'y'.repeat(500), trimmedBy: 0 },
    ]);
    mockMergeSolicitationDocuments.mockReturnValue('merged text');

    const bundle = await loadSolicitationBundle('proj-1', 'opp-1', 'org-1');

    expect(mockApplyPerDocumentBudget).toHaveBeenCalledWith(docs, 150_000);
    expect(bundle).toEqual({
      strategy: 'FULL',
      text: 'merged text',
      documents: [
        { name: 'RFP.pdf', chars: 1_000 },
        { name: 'Attachment.pdf', chars: 500 },
      ],
    });
    expect(mockSummarizeSolicitationDocument).not.toHaveBeenCalled();
  });

  it('stays FULL over the threshold when the hybrid flag is off', async () => {
    delete process.env.SOLUTION_PLAN_HYBRID_SOLICITATION;
    process.env.SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS = '100';
    const docs = [{ file: {}, fileName: 'Huge.pdf', text: 'x'.repeat(1_000) }];
    mockLoadRawSolicitationDocuments.mockResolvedValue(docs);
    mockApplyPerDocumentBudget.mockReturnValue([{ fileName: 'Huge.pdf', text: 'x'.repeat(100), trimmedBy: 900 }]);
    mockMergeSolicitationDocuments.mockReturnValue('trimmed text');

    const bundle = await loadSolicitationBundle('proj-1', 'opp-1', 'org-1');

    expect(bundle.strategy).toBe('FULL');
    expect(mockSummarizeSolicitationDocument).not.toHaveBeenCalled();
  });

  it('routes to SUMMARIZED over the threshold when the hybrid flag is on', async () => {
    process.env.SOLUTION_PLAN_HYBRID_SOLICITATION = '1';
    process.env.SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS = '100';
    const docs = [
      { file: { projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-1' }, fileName: 'Huge.pdf', text: 'x'.repeat(1_000) },
    ];
    mockLoadRawSolicitationDocuments.mockResolvedValue(docs);
    mockSummarizeSolicitationDocument.mockResolvedValue({ summary: 'A big RFP.', sections: ['Scope', 'Pricing'] });

    const bundle = await loadSolicitationBundle('proj-1', 'opp-1', 'org-1');

    expect(bundle).toEqual({
      strategy: 'SUMMARIZED',
      summaries: [{ name: 'Huge.pdf', chars: 1_000, summary: 'A big RFP.', sections: ['Scope', 'Pricing'] }],
      totalChars: 1_000,
    });
    expect(mockSummarizeSolicitationDocument).toHaveBeenCalledWith('org-1', docs[0]!.file, docs[0]!.text);
    expect(mockUpdateQuestionFile).toHaveBeenCalledWith('proj-1', 'opp-1', 'qf-1', {
      summary: 'A big RFP.',
      sections: ['Scope', 'Pricing'],
    });
  });

  it('reuses a cached summary instead of calling the model again', async () => {
    process.env.SOLUTION_PLAN_HYBRID_SOLICITATION = '1';
    process.env.SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS = '100';
    const docs = [
      {
        file: { projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-1', summary: 'Cached.', sections: ['A'] },
        fileName: 'Huge.pdf',
        text: 'x'.repeat(1_000),
      },
    ];
    mockLoadRawSolicitationDocuments.mockResolvedValue(docs);

    const bundle = await loadSolicitationBundle('proj-1', 'opp-1', 'org-1');

    expect(mockSummarizeSolicitationDocument).not.toHaveBeenCalled();
    expect(mockUpdateQuestionFile).not.toHaveBeenCalled();
    expect(bundle).toEqual({
      strategy: 'SUMMARIZED',
      summaries: [{ name: 'Huge.pdf', chars: 1_000, summary: 'Cached.', sections: ['A'] }],
      totalChars: 1_000,
    });
  });

  it('does not fail the plan when persisting a summary fails', async () => {
    process.env.SOLUTION_PLAN_HYBRID_SOLICITATION = '1';
    process.env.SOLUTION_PLAN_FULL_SOLICITATION_THRESHOLD_CHARS = '100';
    const docs = [
      { file: { projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-1' }, fileName: 'Huge.pdf', text: 'x'.repeat(1_000) },
    ];
    mockLoadRawSolicitationDocuments.mockResolvedValue(docs);
    mockSummarizeSolicitationDocument.mockResolvedValue({ summary: 'A big RFP.', sections: ['Scope'] });
    mockUpdateQuestionFile.mockRejectedValue(new Error('ddb boom'));

    const bundle = await loadSolicitationBundle('proj-1', 'opp-1', 'org-1');

    expect(bundle.strategy).toBe('SUMMARIZED');
    await new Promise((resolve) => setImmediate(resolve));
  });
});
