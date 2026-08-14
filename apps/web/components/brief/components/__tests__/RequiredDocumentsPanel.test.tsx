import { render, screen } from '@testing-library/react';
import { RequiredDocumentsPanel } from '../RequiredDocumentsPanel';
import {
  activeGateState,
  gateState,
  grandfatheredGateState,
} from '@/features/solution-plan/testing';
import type { RequiredOutputDocument } from '@auto-rfp/core';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockGenerateDocument = jest.fn();
jest.mock('@/lib/hooks/use-rfp-documents', () => ({
  RFP_DOCUMENT_TYPES: jest.requireActual('@auto-rfp/core').RFP_DOCUMENT_TYPES,
  useGenerateRFPDocument: () => ({ trigger: mockGenerateDocument }),
  useRFPDocuments: () => ({ documents: [], isLoading: false, mutate: jest.fn() }),
  isSolutionPlanRequiredError: () => false,
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

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const requiredDocuments: RequiredOutputDocument[] = [
  { documentType: 'TECHNICAL_PROPOSAL', name: 'Technical Volume', required: true },
  { documentType: 'QUESTIONS_AND_ANSWERS', name: 'Q&A Sheet', required: false },
];

const renderPanel = () =>
  render(
    <RequiredDocumentsPanel
      projectId="proj-1"
      opportunityId="opp-1"
      requiredDocuments={requiredDocuments}
    />,
  );

const generateButtonIn = (rowLabel: string) => {
  const row = screen.getByText(rowLabel).closest('div.flex.items-center.gap-3');
  return row?.querySelector('button') as HTMLButtonElement;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSolutionPlanGate.mockReturnValue(gateState());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RequiredDocumentsPanel — Solution Plan gate', () => {
  it('disables gated rows, keeps exempt rows generatable, and shows the callout', () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGateState());

    renderPanel();

    expect(screen.getByTestId('solution-plan-gate-callout')).toBeInTheDocument();
    expect(generateButtonIn('Technical Volume')).toBeDisabled();
    expect(generateButtonIn('Technical Volume')).toHaveAttribute(
      'title',
      'Create a Solution Plan first',
    );
    expect(generateButtonIn('Q&A Sheet')).not.toBeDisabled();
  });

  it('excludes blocked types from Generate All', () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGateState());

    renderPanel();

    // Only the exempt Q&A doc is still pending-and-generatable.
    expect(screen.getByRole('button', { name: /generate all \(1\)/i })).toBeInTheDocument();
  });

  it('hides Generate All when every pending type is blocked', () => {
    mockUseSolutionPlanGate.mockReturnValue(
      gateState({ isGateActive: true, isDocumentTypeBlocked: () => true }),
    );

    renderPanel();

    expect(screen.queryByRole('button', { name: /generate all/i })).not.toBeInTheDocument();
  });

  it('does not gate anything when the gate is inactive', () => {
    renderPanel();

    expect(screen.queryByTestId('solution-plan-gate-callout')).not.toBeInTheDocument();
    expect(generateButtonIn('Technical Volume')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /generate all \(2\)/i })).toBeInTheDocument();
  });

  it('shows the nudge banner without gating when grandfathered (ADR-10)', () => {
    mockUseSolutionPlanGate.mockReturnValue(grandfatheredGateState());

    renderPanel();

    expect(screen.getByTestId('solution-plan-nudge-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('solution-plan-gate-callout')).not.toBeInTheDocument();
    expect(generateButtonIn('Technical Volume')).not.toBeDisabled();
  });
});
