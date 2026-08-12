import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SolutionPlanEditorPage } from '../SolutionPlanEditorPage';
import type { SolutionPlanItem } from '@auto-rfp/core';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockUseSolutionPlan = jest.fn();
jest.mock('../../hooks/useSolutionPlan', () => ({
  useSolutionPlan: (...args: unknown[]) => mockUseSolutionPlan(...args),
  SOLUTION_PLAN_POLL_INTERVAL_MS: 3_000,
}));

const mockUseSolutionPlanHtmlContent = jest.fn();
jest.mock('../../hooks/useSolutionPlanHtmlContent', () => ({
  useSolutionPlanHtmlContent: (...args: unknown[]) => mockUseSolutionPlanHtmlContent(...args),
}));

const mockUpdateSolutionPlan = jest.fn();
jest.mock('../../hooks/useUpdateSolutionPlan', () => ({
  useUpdateSolutionPlan: () => ({
    updateSolutionPlan: mockUpdateSolutionPlan,
    isUpdating: false,
  }),
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

jest.mock('@/components/layout/page-loading-skeleton', () => ({
  PageLoadingSkeleton: () => <div data-testid="page-loading-skeleton" />,
}));

// TipTap is too heavy for jsdom — a textarea stand-in preserves the
// value/onChange/disabled contract the page relies on.
jest.mock('@/components/rfp-documents/rich-text-editor', () => ({
  RichTextEditor: ({
    value,
    onChange,
    disabled,
  }: {
    value: string;
    onChange: (html: string) => void;
    disabled?: boolean;
  }) => (
    <textarea
      data-testid="rich-text-editor"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
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

const htmlState = (over: Record<string, unknown> = {}) => ({
  content: {
    ok: true,
    html: '<h1>Solution Plan</h1>',
    contentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
    version: 2,
    isStale: false,
    isUserEdited: false,
  },
  isLoading: false,
  notFound: false,
  error: undefined,
  refresh: jest.fn(),
  ...over,
});

const renderPage = () =>
  render(<SolutionPlanEditorPage orgId="org-1" projectId="proj-1" opportunityId="opp-1" />);

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSolutionPlanHtmlContent.mockReturnValue(htmlState());
  mockUpdateSolutionPlan.mockResolvedValue({ ok: true, plan: makePlan({ version: 3 }) });
  mockInitSolutionPlan.mockResolvedValue({ ok: true });
  mockConfirm.mockResolvedValue(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SolutionPlanEditorPage', () => {
  it('shows the page loading skeleton while the plan loads', () => {
    mockUseSolutionPlan.mockReturnValue(planState(null, { isLoading: true, notFound: false }));
    renderPage();
    expect(screen.getByTestId('page-loading-skeleton')).toBeTruthy();
  });

  it('shows a not-found state with a back link when no plan exists', () => {
    mockUseSolutionPlan.mockReturnValue(planState(null));
    renderPage();

    expect(screen.getByText(/no solution plan exists/i)).toBeTruthy();
    const backLink = screen.getByRole('link', { name: /back to opportunity/i });
    expect(backLink.getAttribute('href')).toBe(
      '/organizations/org-1/projects/proj-1/opportunities/opp-1',
    );
  });

  it('shows the in-progress state (not the editor) while a run is in flight', () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan({ status: 'GRILLING' })));
    renderPage();

    expect(screen.getByText(/interview is running/i)).toBeTruthy();
    expect(screen.queryByTestId('rich-text-editor')).toBeNull();
    // No HTML fetch while the run is in flight.
    expect(mockUseSolutionPlanHtmlContent).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'opp-1',
      { enabled: false },
    );
  });

  it('shows the failure alert when the plan FAILED', () => {
    mockUseSolutionPlan.mockReturnValue(
      planState(makePlan({ status: 'FAILED', error: 'Synthesis timed out' })),
    );
    renderPage();

    expect(screen.getByText(/generation failed/i)).toBeTruthy();
    expect(screen.getByText(/synthesis timed out/i)).toBeTruthy();
    expect(screen.queryByTestId('rich-text-editor')).toBeNull();
  });

  it('shows an editor skeleton while the HTML body loads', () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    mockUseSolutionPlanHtmlContent.mockReturnValue(
      htmlState({ content: null, isLoading: true }),
    );
    renderPage();

    expect(screen.getByTestId('solution-plan-editor-skeleton')).toBeTruthy();
    expect(screen.queryByTestId('rich-text-editor')).toBeNull();
  });

  it('renders the editor with the fetched HTML when READY', () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    renderPage();

    const editor = screen.getByTestId('rich-text-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('<h1>Solution Plan</h1>');
    expect(screen.getByText(/version 2/i)).toBeTruthy();
    expect(mockUseSolutionPlanHtmlContent).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'opp-1',
      { enabled: true },
    );
  });

  it('saves edited HTML via the update hook and toasts on success', async () => {
    const state = planState(makePlan());
    mockUseSolutionPlan.mockReturnValue(state);
    renderPage();

    fireEvent.change(screen.getByTestId('rich-text-editor'), {
      target: { value: '<h1>Edited plan</h1>' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockUpdateSolutionPlan).toHaveBeenCalledWith({
        htmlContent: '<h1>Edited plan</h1>',
      }),
    );
    expect(state.refresh).toHaveBeenCalled();
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Solution Plan saved' }),
      ),
    );
  });

  it('toasts a specific message when the save is refused because the plan is not READY (ADR-8)', async () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    mockUpdateSolutionPlan.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        status: 409,
        details: { code: 'SOLUTION_PLAN_NOT_READY' },
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: expect.stringMatching(/not editable right now/i),
        }),
      ),
    );
  });

  it('toasts a reload hint when the save loses a concurrent-edit race (409 conflict)', async () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    mockUpdateSolutionPlan.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        status: 409,
        details: { code: 'SOLUTION_PLAN_CONFLICT' },
      }),
    );
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'destructive',
          description: expect.stringMatching(/changed while you were editing/i),
        }),
      ),
    );
  });

  it('sanitizes scaffold comments out of the fetched HTML before editing', () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    mockUseSolutionPlanHtmlContent.mockReturnValue(
      htmlState({
        content: {
          ok: true,
          html: '<!-- Section guidance: fill this in --><h1>Solution Plan</h1>',
          contentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
          version: 2,
          isStale: false,
          isUserEdited: false,
        },
      }),
    );
    renderPage();

    const editor = screen.getByTestId('rich-text-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe('<h1>Solution Plan</h1>');
  });

  it('warns that manual edits are permanently lost when regenerating an edited plan (ADR-4)', async () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan({ isUserEdited: true })));
    renderPage();

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
    mockUseSolutionPlan.mockReturnValue(planState(makePlan({ isUserEdited: true })));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalled());
    expect(mockInitSolutionPlan).not.toHaveBeenCalled();
  });

  it('shows the staleness warning banner for a stale READY plan', () => {
    mockUseSolutionPlan.mockReturnValue(
      planState(makePlan({ isStale: true, staleReason: 'Executive brief was regenerated.' })),
    );
    renderPage();

    expect(screen.getByText(/may be outdated — regenerate recommended/i)).toBeTruthy();
    expect(screen.getByText(/executive brief was regenerated/i)).toBeTruthy();
    // Stale keeps the editor available (gate stays open — ADR-3).
    expect(screen.getByTestId('rich-text-editor')).toBeTruthy();
  });
});
