import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { GenerateDocumentDialog } from '../generate-document-dialog';
import {
  activeGateState,
  gateState,
  grandfatheredGateState,
} from '@/features/solution-plan/testing';
import {
  blockingCoverageState,
  coverageState,
  gapCoverageState,
  loadingCoverageState,
} from '@/features/kb-coverage/testing';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockGenerateDocument = jest.fn();
jest.mock('@/lib/hooks/use-rfp-documents', () => ({
  RFP_DOCUMENT_TYPES: jest.requireActual('@auto-rfp/core').RFP_DOCUMENT_TYPES,
  useGenerateRFPDocument: () => ({ trigger: mockGenerateDocument }),
  useCustomDocumentTypes: () => ({ customTypes: [] }),
  isSolutionPlanRequiredError: () => false,
  isKBCoverageIncompleteError: () => false,
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

const mockUseKBCoverage = jest.fn();
jest.mock('@/features/kb-coverage', () => ({
  // Real badge component so the named-gap assertions test actual markup.
  ...jest.requireActual('@/features/kb-coverage/components/KBCoverageBadge'),
  useKBCoverage: (...args: unknown[]) => mockUseKBCoverage(...args),
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
  mockUseKBCoverage.mockReturnValue(coverageState());
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GenerateDocumentDialog — Solution Plan gate', () => {
  it('disables gated rows and shows the callout when the gate is active', async () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGateState());

    await renderAndOpenDialog();

    expect(screen.getByTestId('solution-plan-gate-callout')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to solution plan/i })).toHaveAttribute(
      'href',
      '/organizations/org-1/projects/proj-1/opportunities/opp-1?tab=solution-plan',
    );

    // Gated rows are disabled…
    expect(checkboxFor('TECHNICAL_PROPOSAL')).toBeDisabled();
    expect(checkboxFor('COST_PROPOSAL')).toBeDisabled();
    // …exempt rows stay selectable.
    expect(checkboxFor('CLARIFYING_QUESTIONS')).not.toBeDisabled();
    expect(checkboxFor('QUESTIONS_AND_ANSWERS')).not.toBeDisabled();
  });

  it('keeps the Generate button disabled until an exempt row is selected', async () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGateState());

    await renderAndOpenDialog();

    const generateButton = screen.getByRole('button', { name: /generate \(/i });
    expect(generateButton).toBeDisabled();

    fireEvent.click(checkboxFor('CLARIFYING_QUESTIONS'));
    expect(screen.getByRole('button', { name: /generate \(1\)/i })).not.toBeDisabled();
  });

  it('excludes blocked rows from Select all', async () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGateState());

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

  it('shows the nudge banner without gating when grandfathered (ADR-10)', async () => {
    mockUseSolutionPlanGate.mockReturnValue(grandfatheredGateState());

    await renderAndOpenDialog();

    expect(screen.getByTestId('solution-plan-nudge-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('solution-plan-gate-callout')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create a solution plan/i })).toHaveAttribute(
      'href',
      '/organizations/org-1/projects/proj-1/opportunities/opp-1?tab=solution-plan',
    );
    expect(checkboxFor('TECHNICAL_PROPOSAL')).not.toBeDisabled();
  });
});

describe('GenerateDocumentDialog — KB coverage precheck', () => {
  it('does not probe coverage until the dialog is opened', () => {
    mockUseKBCoverage.mockReturnValue(coverageState());

    // Mounted, not opened. The probe's server side pages the org's whole
    // content-library partition, and this component mounts on every opportunity
    // view — including for users who never open it.
    render(<GenerateDocumentDialog projectId="proj-1" opportunityId="opp-1" orgId="org-1" />);

    expect(mockUseKBCoverage).toHaveBeenCalled();
    // An undefined orgId is what makes the hook skip the request entirely.
    expect(mockUseKBCoverage).not.toHaveBeenCalledWith('org-1');
    expect(mockUseKBCoverage.mock.calls.every(([arg]) => arg === undefined)).toBe(true);
  });

  it('probes coverage once the dialog is open', async () => {
    mockUseKBCoverage.mockReturnValue(coverageState());

    await renderAndOpenDialog();

    expect(mockUseKBCoverage).toHaveBeenCalledWith('org-1');
  });

  it('names the missing categories on a type with KB requirements', async () => {
    mockUseKBCoverage.mockReturnValue(gapCoverageState());

    await renderAndOpenDialog();

    // "By name" is the whole point — the badge must say what is missing.
    expect(screen.getByText(/Missing:.*personnel bios/)).toBeInTheDocument();
  });

  it('warns without blocking while the org gate is off', async () => {
    mockUseKBCoverage.mockReturnValue(gapCoverageState());

    await renderAndOpenDialog();

    // Both gated types report a gap, so there is a badge per gated row.
    expect(screen.getAllByText(/Missing:/)).toHaveLength(2);
    expect(checkboxFor('TEAM_QUALIFICATIONS')).not.toBeDisabled();
  });

  it('blocks an uncovered type once the org gate is armed', async () => {
    mockUseKBCoverage.mockReturnValue(blockingCoverageState());

    await renderAndOpenDialog();

    expect(checkboxFor('TEAM_QUALIFICATIONS')).toBeDisabled();
    // A type with no KB requirements is untouched by the coverage gate.
    expect(checkboxFor('COST_PROPOSAL')).not.toBeDisabled();
  });

  it('shows no coverage badge at all for types without KB requirements', async () => {
    mockUseKBCoverage.mockReturnValue(gapCoverageState());

    await renderAndOpenDialog();

    // 16 meaningless ticks would drown the badges that carry information.
    expect(screen.queryByText('KB ready')).not.toBeInTheDocument();
  });

  it('claims nothing while the probe is still in flight', async () => {
    mockUseKBCoverage.mockReturnValue(loadingCoverageState());

    await renderAndOpenDialog();

    // Regression: an empty `missing` list used to render a reassuring
    // "KB ready" badge before the server had answered — and permanently if the
    // probe failed. No verdict means no badge.
    expect(screen.queryByText('KB ready')).not.toBeInTheDocument();
    expect(screen.queryByText(/Missing:/)).not.toBeInTheDocument();
    // And an unanswered probe must never block.
    expect(checkboxFor('TEAM_QUALIFICATIONS')).not.toBeDisabled();
  });

  it('reports a genuinely covered type as ready', async () => {
    mockUseKBCoverage.mockReturnValue(coverageState());

    await renderAndOpenDialog();

    expect(screen.getAllByText('KB ready').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Missing:/)).not.toBeInTheDocument();
  });

  it('blocks a row when either precondition refuses it, and neither over-blocks', async () => {
    mockUseSolutionPlanGate.mockReturnValue(activeGateState());
    mockUseKBCoverage.mockReturnValue(blockingCoverageState());

    await renderAndOpenDialog();

    expect(checkboxFor('TEAM_QUALIFICATIONS')).toBeDisabled();
    expect(checkboxFor('TECHNICAL_PROPOSAL')).toBeDisabled();
    // CLARIFYING_QUESTIONS is exempt from the plan gate and has no KB
    // requirements, so with *both* gates refusing it must still be selectable —
    // neither precondition may leak onto a row it doesn't govern.
    expect(checkboxFor('CLARIFYING_QUESTIONS')).not.toBeDisabled();
  });

  it('blocks on coverage alone, with the plan gate wide open', async () => {
    mockUseSolutionPlanGate.mockReturnValue(gateState());
    mockUseKBCoverage.mockReturnValue(blockingCoverageState());

    await renderAndOpenDialog();

    expect(checkboxFor('TEAM_QUALIFICATIONS')).toBeDisabled();
    expect(checkboxFor('TECHNICAL_PROPOSAL')).not.toBeDisabled();
  });
});
