import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SolutionPlanPanel } from '../SolutionPlanPanel';
import type { SolutionPlanItem } from '@auto-rfp/core';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockUseSolutionPlan = jest.fn();
jest.mock('../../hooks/useSolutionPlan', () => ({
  useSolutionPlan: (...args: unknown[]) => mockUseSolutionPlan(...args),
  SOLUTION_PLAN_POLL_INTERVAL_MS: 3_000,
}));

const mockUseGrillingTranscript = jest.fn();
jest.mock('../../hooks/useGrillingTranscript', () => ({
  useGrillingTranscript: (...args: unknown[]) => mockUseGrillingTranscript(...args),
}));

const mockInitSolutionPlan = jest.fn();
jest.mock('../../hooks/useInitSolutionPlan', () => ({
  useInitSolutionPlan: () => ({
    initSolutionPlan: mockInitSolutionPlan,
    isInitializing: false,
  }),
}));

const mockToast = jest.fn();
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Permission checks need the auth context — grant everything in tests.
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockConfirm = jest.fn();
jest.mock('@/components/ui/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    ConfirmDialog: () => null,
  }),
}));

// The Team Definition section (U3) has its own test suite — stub it here.
jest.mock('../TeamDefinitionSection', () => ({
  TeamDefinitionSection: () => <div data-testid="team-definition-section-stub" />,
}));

// The version history control (U4) has its own test suite — stub it here.
jest.mock('../VersionHistoryControl', () => ({
  VersionHistoryControl: () => <div data-testid="version-history-control-stub" />,
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makePlan = (over: Partial<SolutionPlanItem> = {}): SolutionPlanItem => ({
  id: 'plan-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  status: 'READY',
  isStale: false,
  runId: 'run-1',
  version: 2,
  isUserEdited: false,
  ...over,
});

const planState = (plan: SolutionPlanItem | null, over: Record<string, unknown> = {}) => ({
  plan,
  status: plan?.status ?? null,
  isRunning: plan?.status === 'GRILLING' || plan?.status === 'GENERATING_SOT',
  isLoading: false,
  notFound: plan === null,
  error: undefined,
  refresh: jest.fn(),
  ...over,
});

const renderPanel = () =>
  render(<SolutionPlanPanel orgId="org-1" projectId="proj-1" opportunityId="opp-1" />);

beforeEach(() => {
  jest.clearAllMocks();
  mockUseGrillingTranscript.mockReturnValue({
    messages: [],
    status: null,
    isLoading: false,
  });
  mockInitSolutionPlan.mockResolvedValue({ ok: true });
  mockConfirm.mockResolvedValue(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SolutionPlanPanel', () => {
  it('shows a skeleton while loading', () => {
    mockUseSolutionPlan.mockReturnValue(
      planState(null, { isLoading: true, notFound: false }),
    );
    renderPanel();
    expect(screen.getByTestId('solution-plan-skeleton')).toBeTruthy();
  });

  it('shows the Start CTA when no plan exists and starts a run on click', async () => {
    const state = planState(null);
    mockUseSolutionPlan.mockReturnValue(state);
    renderPanel();

    const startButton = screen.getByRole('button', { name: /start solution plan/i });
    fireEvent.click(startButton);

    await waitFor(() => expect(mockInitSolutionPlan).toHaveBeenCalledWith(undefined));
    expect(state.refresh).toHaveBeenCalled();
  });

  it('shows the live transcript while GRILLING', () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan({ status: 'GRILLING' })));
    mockUseGrillingTranscript.mockReturnValue({
      messages: [
        { id: 'm1', round: 1, role: 'GRILLER', content: 'How many users?' },
        { id: 'm2', round: 1, role: 'TECH_LEAD', content: 'About 500.' },
      ],
      status: 'GRILLING',
      isLoading: false,
    });
    renderPanel();

    expect(screen.getByText('Interview in Progress')).toBeTruthy();
    expect(screen.getByText('How many users?')).toBeTruthy();
    expect(screen.getByText('About 500.')).toBeTruthy();
    // The transcript hook is enabled while running.
    expect(mockUseGrillingTranscript).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'opp-1',
      { enabled: true },
    );
  });

  it('shows the synthesis state while GENERATING_SOT', () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan({ status: 'GENERATING_SOT' })));
    renderPanel();

    expect(screen.getByText(/synthesizing the solution plan/i)).toBeTruthy();
    expect(screen.getByTestId('synthesis-skeleton')).toBeTruthy();
  });

  it('shows View & Edit and Regenerate when READY', () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    renderPanel();

    const editLink = screen.getByRole('link', { name: /view & edit/i });
    expect(editLink.getAttribute('href')).toBe(
      '/organizations/org-1/projects/proj-1/opportunities/opp-1/solution-plan/edit',
    );
    expect(screen.getByRole('button', { name: /regenerate/i })).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.queryByText(/may be outdated/i)).toBeNull();
  });

  it('shows the staleness warning banner for a stale READY plan', () => {
    mockUseSolutionPlan.mockReturnValue(
      planState(makePlan({ isStale: true, staleReason: 'Executive brief was regenerated.' })),
    );
    renderPanel();

    expect(screen.getByText(/may be outdated — regenerate recommended/i)).toBeTruthy();
    expect(screen.getByText(/executive brief was regenerated/i)).toBeTruthy();
    // Stale does not remove the edit/regenerate actions (gate stays open).
    expect(screen.getByRole('link', { name: /view & edit/i })).toBeTruthy();
  });

  it('confirms before regenerating and warns that manual edits are permanently lost (ADR-4)', async () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan({ isUserEdited: true })));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(/manual edits will be permanently lost/i),
          variant: 'destructive',
        }),
      ),
    );
    await waitFor(() => expect(mockInitSolutionPlan).toHaveBeenCalled());
  });

  it('does not regenerate when the confirm dialog is cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockInitSolutionPlan).not.toHaveBeenCalled();
  });

  it('uses a neutral confirm message when the plan has no manual edits', async () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan({ isUserEdited: false })));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.not.stringMatching(/permanently lost/i),
          variant: 'default',
        }),
      ),
    );
  });

  it('shows the failure alert and Retry when FAILED', async () => {
    const state = planState(makePlan({ status: 'FAILED', error: 'Synthesis timed out' }));
    mockUseSolutionPlan.mockReturnValue(state);
    renderPanel();

    expect(screen.getByText(/generation failed/i)).toBeTruthy();
    expect(screen.getByText(/synthesis timed out/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(mockInitSolutionPlan).toHaveBeenCalled());
  });

  it('toasts when starting a run fails', async () => {
    const error = Object.assign(new Error('No processed solicitation documents'), {
      status: 400,
    });
    mockInitSolutionPlan.mockRejectedValue(error);
    mockUseSolutionPlan.mockReturnValue(planState(null));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /start solution plan/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: 'No processed solicitation documents',
        }),
      ),
    );
  });

  it('disables Start Solution Plan with an explanation when there are no solicitation docs', () => {
    mockUseSolutionPlan.mockReturnValue(planState(null));
    render(
      <SolutionPlanPanel
        orgId="org-1"
        projectId="proj-1"
        opportunityId="opp-1"
        hasSolicitationDocs={false}
      />,
    );

    const startButton = screen.getByRole('button', { name: /start solution plan/i });
    expect((startButton as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(/upload solicitation documents first — the solution plan is generated from them/i),
    ).toBeTruthy();

    fireEvent.click(startButton);
    expect(mockInitSolutionPlan).not.toHaveBeenCalled();
  });

  it('disables Regenerate when there are no solicitation docs', () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    render(
      <SolutionPlanPanel
        orgId="org-1"
        projectId="proj-1"
        opportunityId="opp-1"
        hasSolicitationDocs={false}
      />,
    );

    const regenerateButton = screen.getByRole('button', { name: /regenerate/i });
    expect((regenerateButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps generation enabled when hasSolicitationDocs is not provided', () => {
    mockUseSolutionPlan.mockReturnValue(planState(null));
    renderPanel();

    const startButton = screen.getByRole('button', { name: /start solution plan/i });
    expect((startButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('offers a restart when the server reports a run already in progress (409)', async () => {
    const conflict = Object.assign(new Error('run in progress'), { status: 409 });
    mockInitSolutionPlan.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ ok: true });
    mockUseSolutionPlan.mockReturnValue(planState(null));
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /start solution plan/i }));

    await waitFor(() =>
      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ confirmLabel: 'Restart run' }),
      ),
    );
    await waitFor(() =>
      expect(mockInitSolutionPlan).toHaveBeenLastCalledWith({ restart: true }),
    );
  });
});
