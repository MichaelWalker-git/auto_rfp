import { renderHook, waitFor } from '@testing-library/react';

// ─── Mocks for every data source the assembly hook reads ─────────────────────────

const mockUseCurrentOrganization = jest.fn();
const mockUseOpportunityContext = jest.fn();
const mockUseQuestionFiles = jest.fn();
const mockUseGetBrief = jest.fn();
const mockUseRFPDocuments = jest.fn();
const mockUseApi = jest.fn();
const mockUseSolutionPlan = jest.fn();
const mockUseReviewRun = jest.fn();
const mockUseComplianceReport = jest.fn();
const mockUseSubmissionHistory = jest.fn();

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => mockUseCurrentOrganization(),
}));
jest.mock('@/components/opportunities/opportunity-context', () => ({
  useOpportunityContext: () => mockUseOpportunityContext(),
}));
jest.mock('@/lib/hooks/use-question-file', () => ({
  useQuestionFiles: () => mockUseQuestionFiles(),
}));
jest.mock('@/lib/hooks/use-executive-brief', () => ({
  useGetExecutiveBriefByProject: () => mockUseGetBrief(),
}));
jest.mock('@/lib/hooks/use-rfp-documents', () => ({
  useRFPDocuments: () => mockUseRFPDocuments(),
}));
jest.mock('@/lib/hooks/api-helpers', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
  buildApiUrl: (path: string) => path,
}));
jest.mock('@/features/solution-plan', () => ({
  useSolutionPlan: () => mockUseSolutionPlan(),
}));
jest.mock('@/features/compliance-review', () => ({
  useReviewRun: () => mockUseReviewRun(),
}));
jest.mock('@/features/proposal-submission', () => ({
  useComplianceReport: () => mockUseComplianceReport(),
  useSubmissionHistory: () => mockUseSubmissionHistory(),
}));

import { useOpportunityProgress } from '../useOpportunityProgress';

const defaults = () => {
  mockUseCurrentOrganization.mockReturnValue({
    currentOrganization: { id: 'org1', enableSolutionPlan: true, enableComplianceReview: true },
  });
  mockUseOpportunityContext.mockReturnValue({ projectId: 'p1', oppId: 'o1', orgId: 'org1' });
  mockUseQuestionFiles.mockReturnValue({
    items: [{ status: 'PROCESSED', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }],
    isLoading: false,
    isError: false,
  });
  mockUseGetBrief.mockReturnValue({ trigger: jest.fn().mockResolvedValue({ brief: null }) });
  mockUseSolutionPlan.mockReturnValue({ plan: null, error: null });
  mockUseApi.mockReturnValue({ data: { forms: [{ name: 'F', status: 'PENDING', totalFieldCount: 2, manualFieldCount: 1, createdAt: 'a', updatedAt: 'a' }] }, isError: false });
  mockUseRFPDocuments.mockReturnValue({ documents: [], isError: false });
  mockUseReviewRun.mockReturnValue({ run: null, findings: [], decisions: [], stale: false, error: null });
  mockUseComplianceReport.mockReturnValue({ report: null, passRate: undefined, error: null });
  mockUseSubmissionHistory.mockReturnValue({ submissions: [], error: null });
};

beforeEach(() => {
  jest.clearAllMocks();
  defaults();
});

const ids = (steps: { stepId: string }[]) => steps.map((s) => s.stepId);

describe('useOpportunityProgress — visible step set (FR1.5/FR1.6)', () => {
  it('includes all seven steps when features are on and forms are detected', async () => {
    const { result } = renderHook(() => useOpportunityProgress());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ids(result.current.steps)).toEqual([
      'solicitations',
      'analysis',
      'solution-plan',
      'required-forms',
      'rfp-documents',
      'ai-review',
      'submission',
    ]);
  });

  it('hides solution-plan and ai-review when their org flags are off', async () => {
    mockUseCurrentOrganization.mockReturnValue({
      currentOrganization: { id: 'org1', enableSolutionPlan: false, enableComplianceReview: false },
    });
    const { result } = renderHook(() => useOpportunityProgress());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ids(result.current.steps)).not.toContain('solution-plan');
    expect(ids(result.current.steps)).not.toContain('ai-review');
  });

  it('hides required-forms when none are detected', async () => {
    mockUseApi.mockReturnValue({ data: { forms: [] }, isError: false });
    const { result } = renderHook(() => useOpportunityProgress());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(ids(result.current.steps)).not.toContain('required-forms');
  });
});

describe('useOpportunityProgress — navigation + assembly', () => {
  it('gives every step an anchor navigation descriptor', async () => {
    const { result } = renderHook(() => useOpportunityProgress());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    for (const step of result.current.steps) {
      expect(step.navigation.kind).toBe('anchor');
    }
    const solicitations = result.current.steps.find((s) => s.stepId === 'solicitations');
    expect(solicitations?.navigation).toEqual({ kind: 'anchor', sectionId: 'solicitation-documents' });
  });

  it('computes the Solicitations step complete from processed files', async () => {
    const { result } = renderHook(() => useOpportunityProgress());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const solicitations = result.current.steps.find((s) => s.stepId === 'solicitations');
    expect(solicitations?.status).toBe('complete');
    expect(solicitations?.detailText).toBe('1 of 1 processed');
  });
});

describe('useOpportunityProgress — failure isolation (BR3.1)', () => {
  it('degrades only the failing step to unavailable', async () => {
    mockUseRFPDocuments.mockReturnValue({ documents: [], isError: true });
    const { result } = renderHook(() => useOpportunityProgress());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const rfp = result.current.steps.find((s) => s.stepId === 'rfp-documents');
    const solicitations = result.current.steps.find((s) => s.stepId === 'solicitations');
    expect(rfp?.status).toBe('unavailable');
    // a sibling step is unaffected
    expect(solicitations?.status).toBe('complete');
  });
});

describe('useOpportunityProgress — re-upload staleness wiring (BR2.1)', () => {
  it('flips a form step whose work predates the newest solicitation upload', async () => {
    // forms fully filled but stamped before a newer solicitation upload
    mockUseApi.mockReturnValue({
      data: {
        forms: [
          { name: 'F', status: 'DONE', totalFieldCount: 2, manualFieldCount: 0, fields: [{ fieldId: 'f-0', value: 'x' }, { fieldId: 'f-1', value: 'x' }], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        ],
      },
      isError: false,
    });
    mockUseQuestionFiles.mockReturnValue({
      items: [{ status: 'PROCESSED', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' }],
      isLoading: false,
      isError: false,
    });
    const { result } = renderHook(() => useOpportunityProgress());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const forms = result.current.steps.find((s) => s.stepId === 'required-forms');
    expect(forms?.status).toBe('needs-attention');
    expect(forms?.detailText).toBe('1 of 1 filled'); // count preserved
  });

  it('does NOT flip on a solicitation updatedAt bump alone (CR-1 — createdAt is the upload basis)', async () => {
    // Solicitation was uploaded long ago (createdAt) but its updatedAt was bumped by
    // the downstream pipeline. A completed form stamped between the two must stay
    // complete — staleness keys off createdAt only, never the late updatedAt.
    mockUseApi.mockReturnValue({
      data: {
        forms: [
          { name: 'F', status: 'DONE', totalFieldCount: 2, manualFieldCount: 0, fields: [{ fieldId: 'f-0', value: 'x' }, { fieldId: 'f-1', value: 'x' }], createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' },
        ],
      },
      isError: false,
    });
    mockUseQuestionFiles.mockReturnValue({
      items: [{ status: 'PROCESSED', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-03-01T00:00:00Z' }],
      isLoading: false,
      isError: false,
    });
    const { result } = renderHook(() => useOpportunityProgress());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const forms = result.current.steps.find((s) => s.stepId === 'required-forms');
    expect(forms?.status).toBe('complete');
  });
});
