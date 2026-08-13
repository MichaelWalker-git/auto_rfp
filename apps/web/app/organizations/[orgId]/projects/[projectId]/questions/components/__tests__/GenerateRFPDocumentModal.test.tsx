import { render, screen } from '@testing-library/react';
import { GenerateRFPDocumentModal } from '../GenerateRFPDocumentModal';
import { activeGateState, gateState } from '@/features/solution-plan/testing';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockTriggerGenerate = jest.fn();
jest.mock('@/lib/hooks/use-rfp-documents', () => ({
  useGenerateRFPDocument: () => ({
    trigger: mockTriggerGenerate,
    isMutating: false,
    error: undefined,
  }),
  useRFPDocumentPolling: () => ({
    document: null,
    isGenerating: false,
    isError: false,
    error: undefined,
  }),
  useUpdateRFPDocument: () => ({ trigger: jest.fn(), isMutating: false }),
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({
    currentOrganization: { id: 'org-1', enableSolutionPlan: true },
  }),
}));

const mockUseSolutionPlanGate = jest.fn();
jest.mock('@/features/solution-plan', () => ({
  ...jest.requireActual('@/features/solution-plan/components/SolutionPlanGateCallout'),
  useSolutionPlanGate: (...args: unknown[]) => mockUseSolutionPlanGate(...args),
}));

jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/components/rfp-documents/rich-text-editor', () => ({
  RichTextEditor: () => null,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSolutionPlanGate.mockReturnValue(gateState());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GenerateRFPDocumentModal — Solution Plan gate', () => {
  it('disables the Generate Proposal button when the gate blocks TECHNICAL_PROPOSAL', () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGateState());

    render(<GenerateRFPDocumentModal projectId="proj-1" opportunityId="opp-1" />);

    const button = screen.getByRole('button', { name: /generate proposal/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'Create a Solution Plan first');
  });

  it('keeps the Generate Proposal button enabled when the gate is open', () => {
    render(<GenerateRFPDocumentModal projectId="proj-1" opportunityId="opp-1" />);

    expect(screen.getByRole('button', { name: /generate proposal/i })).not.toBeDisabled();
  });
});
