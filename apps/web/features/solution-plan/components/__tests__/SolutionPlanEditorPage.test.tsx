import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SolutionPlanEditorPage } from '../SolutionPlanEditorPage';
import { makeHtmlContentResponse } from '../../hooks/__tests__/test-utils';
import type { SolutionPlanItem } from '@auto-rfp/core';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

// The version history control (U4) has its own test suite — stub it here.
jest.mock('../VersionHistoryControl', () => ({
  VersionHistoryControl: () => <div data-testid="version-history-control-stub" />,
}));

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

jest.mock('../../hooks/useEditorImageUpload', () => ({
  useEditorImageUpload: () => ({
    isImageUploading: false,
    setIsImageUploading: jest.fn(),
    handleUploadImageToS3: jest.fn(),
    handleGetDownloadUrl: jest.fn(),
  }),
}));

const mockUseCurrentOrganization = jest.fn();
jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => mockUseCurrentOrganization(),
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
const mockStripPresignedUrls = jest.fn();
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
  stripPresignedUrlsFromHtml: (html: string) => mockStripPresignedUrls(html),
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
  content: makeHtmlContentResponse(),
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
  mockUseCurrentOrganization.mockReturnValue({
    currentOrganization: { id: 'org-1', name: 'Org 1', enableSolutionPlan: true },
    loading: false,
  });
  mockUseSolutionPlanHtmlContent.mockReturnValue(htmlState());
  mockUpdateSolutionPlan.mockResolvedValue({ ok: true, plan: makePlan({ version: 3 }) });
  mockInitSolutionPlan.mockResolvedValue({ ok: true });
  mockConfirm.mockResolvedValue(true);
  mockStripPresignedUrls.mockImplementation((html: string) => html);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SolutionPlanEditorPage', () => {
  it('shows the page loading skeleton while the plan loads', () => {
    mockUseSolutionPlan.mockReturnValue(planState(null, { isLoading: true, notFound: false }));
    renderPage();
    expect(screen.getByTestId('page-loading-skeleton')).toBeTruthy();
  });

  it('shows the page loading skeleton while the organization loads', () => {
    mockUseCurrentOrganization.mockReturnValue({ currentOrganization: null, loading: true });
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    renderPage();
    expect(screen.getByTestId('page-loading-skeleton')).toBeTruthy();
  });

  it('blocks the editor when the org does not have enableSolutionPlan (R2 flag)', () => {
    mockUseCurrentOrganization.mockReturnValue({
      currentOrganization: { id: 'org-1', name: 'Org 1' },
      loading: false,
    });
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    renderPage();

    expect(screen.getByText(/not enabled for this organization/i)).toBeTruthy();
    expect(screen.queryByTestId('rich-text-editor')).toBeNull();
    // The HTML body is not fetched for flag-off orgs.
    expect(mockUseSolutionPlanHtmlContent).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'opp-1',
      { enabled: false },
    );
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
    // The static "Version {n}" text was replaced by the version dropdown (U4).
    expect(screen.getByTestId('version-history-control-stub')).toBeTruthy();
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

  it('strips presigned image URLs from the HTML before saving', async () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    mockStripPresignedUrls.mockImplementation(() => '<p>stripped</p>');
    renderPage();

    fireEvent.change(screen.getByTestId('rich-text-editor'), {
      target: { value: '<img src="https://s3.presigned/example.png">' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockUpdateSolutionPlan).toHaveBeenCalledWith({
        htmlContent: '<p>stripped</p>',
      }),
    );
    expect(mockStripPresignedUrls).toHaveBeenCalledWith(
      '<img src="https://s3.presigned/example.png">',
    );
  });

  it('does not remount the editor after a save (the cursor position survives)', async () => {
    mockUseSolutionPlan.mockReturnValue(planState(makePlan()));
    renderPage();

    const editorBefore = screen.getByTestId('rich-text-editor');
    fireEvent.change(editorBefore, { target: { value: '<h1>Edited plan</h1>' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Solution Plan saved' }),
      ),
    );
    // Same DOM node ⇒ React did not remount the editor; the local (edited)
    // content is preserved rather than being reset from the refetched HTML.
    const editorAfter = screen.getByTestId('rich-text-editor') as HTMLTextAreaElement;
    expect(editorAfter).toBe(editorBefore);
    expect(editorAfter.value).toBe('<h1>Edited plan</h1>');
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
        content: makeHtmlContentResponse({
          html: '<!-- Section guidance: fill this in --><h1>Solution Plan</h1>',
        }),
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
});
