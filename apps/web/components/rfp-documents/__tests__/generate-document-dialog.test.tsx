import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GenerateDocumentDialog } from '../generate-document-dialog';
import type { SolutionPlanGate } from '@/features/solution-plan';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockGenerateDocument = jest.fn();
jest.mock('@/lib/hooks/use-rfp-documents', () => ({
  RFP_DOCUMENT_TYPES: jest.requireActual('@auto-rfp/core').RFP_DOCUMENT_TYPES,
  useGenerateRFPDocument: () => ({ trigger: mockGenerateDocument }),
  useCustomDocumentTypes: () => ({ customTypes: [] }),
  isSolutionPlanRequiredError: () => false,
}));

jest.mock('@/lib/hooks/use-executive-brief', () => ({
  useGetExecutiveBriefByProject: () => ({
    trigger: jest.fn().mockResolvedValue(undefined),
    data: undefined,
  }),
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({
    currentOrganization: { id: 'org-1', enableSolutionPlan: true },
  }),
}));

const mockUseSolutionPlanGate = jest.fn();
jest.mock('@/features/solution-plan', () => ({
  // Real callout component so the href/testid assertions test actual markup.
  ...jest.requireActual('@/features/solution-plan/components/SolutionPlanGateCallout'),
  useSolutionPlanGate: (...args: unknown[]) => mockUseSolutionPlanGate(...args),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('../template-selector', () => ({
  TemplateSelector: () => null,
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EXEMPT_TYPES = ['CLARIFYING_QUESTIONS', 'QUESTIONS_AND_ANSWERS'];

const gateState = (over: Partial<SolutionPlanGate> = {}): SolutionPlanGate => ({
  isEnabled: true,
  plan: null,
  isGateActive: false,
  isDocumentTypeBlocked: () => false,
  ...over,
});

const activeGate = () =>
  gateState({
    isGateActive: true,
    isDocumentTypeBlocked: (documentType: string) => !EXEMPT_TYPES.includes(documentType),
  });

const renderAndOpenDialog = async () => {
  render(
    <GenerateDocumentDialog projectId="proj-1" opportunityId="opp-1" orgId="org-1" />,
  );
  fireEvent.click(screen.getByRole('button', { name: /generate/i }));
  await waitFor(() => expect(screen.getByText('Generate Documents')).toBeInTheDocument());
};

const checkboxFor = (key: string) =>
  document.getElementById(`gen-${key}`) as HTMLButtonElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSolutionPlanGate.mockReturnValue(gateState());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GenerateDocumentDialog — Solution Plan gate', () => {
  it('disables gated rows and shows the callout when the gate is active', async () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGate());

    await renderAndOpenDialog();

    expect(screen.getByTestId('solution-plan-gate-callout')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to solution plan/i })).toHaveAttribute(
      'href',
      '/organizations/org-1/projects/proj-1/opportunities/opp-1#solution-plan',
    );

    // Gated rows are disabled…
    expect(checkboxFor('TECHNICAL_PROPOSAL')).toBeDisabled();
    expect(checkboxFor('COST_PROPOSAL')).toBeDisabled();
    // …exempt rows stay selectable.
    expect(checkboxFor('CLARIFYING_QUESTIONS')).not.toBeDisabled();
    expect(checkboxFor('QUESTIONS_AND_ANSWERS')).not.toBeDisabled();
  });

  it('keeps the Generate button disabled until an exempt row is selected', async () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGate());

    await renderAndOpenDialog();

    const generateButton = screen.getByRole('button', { name: /generate \(/i });
    expect(generateButton).toBeDisabled();

    fireEvent.click(checkboxFor('CLARIFYING_QUESTIONS'));
    expect(screen.getByRole('button', { name: /generate \(1\)/i })).not.toBeDisabled();
  });

  it('excludes blocked rows from Select all', async () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGate());

    await renderAndOpenDialog();

    fireEvent.click(screen.getByRole('button', { name: /select all/i }));

    expect(checkboxFor('TECHNICAL_PROPOSAL')).not.toBeChecked();
    expect(checkboxFor('CLARIFYING_QUESTIONS')).toBeChecked();
    // Only the two exempt rows can be selected while the gate is active.
    expect(screen.getByRole('button', { name: /generate \(2\)/i })).toBeInTheDocument();
  });

  it('does not gate anything when the gate is inactive', async () => {
    await renderAndOpenDialog();

    expect(screen.queryByTestId('solution-plan-gate-callout')).not.toBeInTheDocument();
    expect(checkboxFor('TECHNICAL_PROPOSAL')).not.toBeDisabled();
    expect(checkboxFor('COST_PROPOSAL')).not.toBeDisabled();
  });
});
