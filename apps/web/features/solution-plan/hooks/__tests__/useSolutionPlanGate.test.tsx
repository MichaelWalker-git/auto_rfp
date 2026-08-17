import { renderHook } from '@testing-library/react';
import type { SolutionPlanItem } from '@auto-rfp/core';
import { useSolutionPlanGate } from '../useSolutionPlanGate';

const mockUseCurrentOrganization = jest.fn();
jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => mockUseCurrentOrganization(),
}));

const mockUseSolutionPlan = jest.fn();
jest.mock('../useSolutionPlan', () => ({
  useSolutionPlan: (...args: unknown[]) => mockUseSolutionPlan(...args),
}));

const mockUseRFPDocuments = jest.fn();
jest.mock('@/lib/hooks/use-rfp-documents', () => ({
  useRFPDocuments: (...args: unknown[]) => mockUseRFPDocuments(...args),
}));

const plan = (over: Partial<SolutionPlanItem> = {}): SolutionPlanItem => ({
  id: 'plan-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  status: 'READY',
  isStale: false,
  runId: 'run-1',
  version: 1,
  isUserEdited: false,
  ...over,
});

const generatedDoc = {
  documentType: 'TECHNICAL_PROPOSAL',
  htmlContentKey: 'org/doc.html',
  content: null,
  fileKey: null,
  originalFileName: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseCurrentOrganization.mockReturnValue({
    currentOrganization: { id: 'org-1', enableSolutionPlan: true },
  });
  mockUseSolutionPlan.mockReturnValue({ plan: null, isLoading: false });
  mockUseRFPDocuments.mockReturnValue({ documents: [], isLoading: false });
});

const render = () =>
  renderHook(() => useSolutionPlanGate('org-1', 'proj-1', 'opp-1')).result;

describe('useSolutionPlanGate', () => {
  it('activates the gate when the feature is on and no plan exists', () => {
    const result = render();

    expect(result.current.isGateActive).toBe(true);
    expect(result.current.isGrandfathered).toBe(false);
    expect(result.current.isDocumentTypeBlocked('TECHNICAL_PROPOSAL')).toBe(true);
    expect(result.current.isDocumentTypeBlocked('MY_CUSTOM_TYPE')).toBe(true);
  });

  it('never blocks exempt document types', () => {
    const result = render();

    expect(result.current.isDocumentTypeBlocked('CLARIFYING_QUESTIONS')).toBe(false);
    expect(result.current.isDocumentTypeBlocked('QUESTIONS_AND_ANSWERS')).toBe(false);
    expect(result.current.isDocumentTypeBlocked('QUESTIONNAIRE')).toBe(false);
  });

  it('opens the gate when the org flag is off, without fetching anything', () => {
    mockUseCurrentOrganization.mockReturnValue({
      currentOrganization: { id: 'org-1', enableSolutionPlan: false },
    });

    const result = render();

    expect(result.current.isEnabled).toBe(false);
    expect(result.current.isGateActive).toBe(false);
    // Plan fetch disabled (undefined ids) and documents fetch disabled (null ids)
    expect(mockUseSolutionPlan).toHaveBeenCalledWith(undefined, undefined, undefined);
    expect(mockUseRFPDocuments).toHaveBeenCalledWith(null, null, 'opp-1');
  });

  it('opens the gate for a READY plan, stale or not', () => {
    mockUseSolutionPlan.mockReturnValue({ plan: plan({ isStale: true }), isLoading: false });

    const result = render();

    expect(result.current.isGateActive).toBe(false);
    // A READY plan is not grandfathering — no nudge banner.
    expect(result.current.isGrandfathered).toBe(false);
    expect(result.current.isDocumentTypeBlocked('COST_PROPOSAL')).toBe(false);
  });

  it('keeps the gate closed for a non-READY plan', () => {
    mockUseSolutionPlan.mockReturnValue({ plan: plan({ status: 'GRILLING' }), isLoading: false });

    const result = render();

    expect(result.current.isGateActive).toBe(true);
  });

  it('opens the gate and reports grandfathering for grandfathered opportunities (ADR-10)', () => {
    mockUseRFPDocuments.mockReturnValue({ documents: [generatedDoc], isLoading: false });

    const result = render();

    expect(result.current.isGateActive).toBe(false);
    expect(result.current.isGrandfathered).toBe(true);
  });

  it('does not block while the plan or documents are still loading', () => {
    mockUseSolutionPlan.mockReturnValue({ plan: null, isLoading: true });
    expect(render().current.isGateActive).toBe(false);

    mockUseSolutionPlan.mockReturnValue({ plan: null, isLoading: false });
    mockUseRFPDocuments.mockReturnValue({ documents: [], isLoading: true });
    const result = render();
    expect(result.current.isGateActive).toBe(false);
    // Not grandfathered either while loading — no premature nudge.
    expect(result.current.isGrandfathered).toBe(false);
  });

  it('closes the gate for a READY NO_BID plan and reports isNoBid', () => {
    mockUseSolutionPlan.mockReturnValue({
      plan: plan({ bidDecision: 'NO_BID' }),
      isLoading: false,
    });

    const result = render();

    expect(result.current.isNoBid).toBe(true);
    expect(result.current.isGateActive).toBe(true);
    expect(result.current.isDocumentTypeBlocked('COST_PROPOSAL')).toBe(true);
    expect(result.current.isDocumentTypeBlocked('CLARIFYING_QUESTIONS')).toBe(false);
  });

  it('does not let grandfathered documents override a NO_BID decision', () => {
    mockUseSolutionPlan.mockReturnValue({
      plan: plan({ bidDecision: 'NO_BID' }),
      isLoading: false,
    });
    mockUseRFPDocuments.mockReturnValue({ documents: [generatedDoc], isLoading: false });

    const result = render();

    expect(result.current.isGateActive).toBe(true);
    expect(result.current.isGrandfathered).toBe(false);
    // The grandfather check is skipped entirely for NO_BID plans
    expect(mockUseRFPDocuments).toHaveBeenCalledWith(null, null, 'opp-1');
  });

  it('opens the gate for READY plans with BID or no decision (legacy)', () => {
    mockUseSolutionPlan.mockReturnValue({
      plan: plan({ bidDecision: 'BID' }),
      isLoading: false,
    });
    expect(render().current.isGateActive).toBe(false);

    mockUseSolutionPlan.mockReturnValue({ plan: plan(), isLoading: false });
    const result = render();
    expect(result.current.isGateActive).toBe(false);
    expect(result.current.isNoBid).toBe(false);
  });

  it("resolves a missing opportunityId to 'default' like the server", () => {
    renderHook(() => useSolutionPlanGate('org-1', 'proj-1', undefined));

    expect(mockUseSolutionPlan).toHaveBeenCalledWith('org-1', 'proj-1', 'default');
    expect(mockUseRFPDocuments).toHaveBeenCalledWith('proj-1', 'org-1', 'default');
  });
});
