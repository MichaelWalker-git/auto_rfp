import { fireEvent, render, screen } from '@testing-library/react';
import { OpportunitySolicitationDocuments } from '../opportunity-attachments';
import type { QuestionFileItem } from '@auto-rfp/core';

// ─── Hook / dependency mocks ──────────────────────────────────────────────────

const mockUseQuestionFiles = jest.fn();
jest.mock('@/lib/hooks/use-question-file', () => ({
  useQuestionFiles: (...args: unknown[]) => mockUseQuestionFiles(...args),
  useDeleteQuestionFile: () => ({ trigger: jest.fn() }),
  useReextractQuestions: () => ({ trigger: jest.fn() }),
  useReextractAllQuestions: () => ({ trigger: jest.fn() }),
  useStartQuestionFilePipeline: () => ({ trigger: jest.fn() }),
}));

jest.mock('@/lib/hooks/use-file', () => ({
  useDownloadFromS3: () => ({ downloadFile: jest.fn(), error: null }),
}));

jest.mock('@/lib/hooks/use-presign', () => ({
  usePresignDownload: () => ({ trigger: jest.fn() }),
}));

jest.mock('@/lib/hooks/api-helpers', () => ({
  useApi: () => ({ data: undefined }),
  buildApiUrl: () => 'https://example.test/required-forms/list',
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock('@/components/ui/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn().mockResolvedValue(false),
    ConfirmDialog: () => null,
  }),
}));

jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  usePermission: () => true,
}));

jest.mock('@/components/cancel-pipeline-button', () => ({
  CancelPipelineButton: () => null,
}));

jest.mock(
  '@/app/organizations/[orgId]/projects/[projectId]/questions/components/question-extraction-dialog',
  () => ({
    QuestionFileUploadDialog: () => <div data-testid="upload-dialog-stub" />,
  }),
);

jest.mock('../opportunity-context', () => ({
  useOpportunityContext: () => ({
    projectId: 'proj-1',
    oppId: 'opp-1',
    orgId: 'org-1',
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeFile = (id: string, status: string): QuestionFileItem =>
  ({
    questionFileId: id,
    projectId: 'proj-1',
    oppId: 'opp-1',
    status,
    fileKey: `uploads/${id}.pdf`,
    originalFileName: `${id}.pdf`,
    createdAt: '2026-08-01T10:00:00Z',
  }) as QuestionFileItem;

const setFiles = (items: QuestionFileItem[], over: Record<string, unknown> = {}) => {
  mockUseQuestionFiles.mockReturnValue({
    items,
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: jest.fn(),
    ...over,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OpportunitySolicitationDocuments', () => {
  it('shows processed / in-progress / error counters in the header', () => {
    setFiles([
      makeFile('doc-1', 'PROCESSED'),
      makeFile('doc-2', 'ANSWERS_READY'),
      makeFile('doc-3', 'PROCESSING'),
      makeFile('doc-4', 'FAILED'),
    ]);
    render(<OpportunitySolicitationDocuments />);

    expect(screen.getByText(/2 of 4 processed/i)).toBeTruthy();
    expect(screen.getByText(/1 in progress/i)).toBeTruthy();
    expect(screen.getByText(/1 error/i)).toBeTruthy();
  });

  it('omits the in-progress and error counters when everything is processed', () => {
    setFiles([makeFile('doc-1', 'PROCESSED'), makeFile('doc-2', 'PROCESSED')]);
    render(<OpportunitySolicitationDocuments />);

    expect(screen.getByText(/2 of 2 processed/i)).toBeTruthy();
    expect(screen.queryByText(/in progress/i)).toBeNull();
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it('excludes DELETED files from the counters', () => {
    setFiles([
      makeFile('doc-1', 'PROCESSED'),
      makeFile('doc-2', 'DELETED'),
    ]);
    render(<OpportunitySolicitationDocuments />);

    expect(screen.getByText(/1 of 1 processed/i)).toBeTruthy();
  });

  it('shows the empty state when there are no documents', () => {
    setFiles([]);
    render(<OpportunitySolicitationDocuments />);

    expect(screen.getByText(/no solicitation documents yet/i)).toBeTruthy();
  });

  it('collapses to 3 documents with a Show all toggle when there are more than 3', () => {
    setFiles([
      makeFile('doc-1', 'PROCESSED'),
      makeFile('doc-2', 'PROCESSED'),
      makeFile('doc-3', 'PROCESSED'),
      makeFile('doc-4', 'PROCESSED'),
      makeFile('doc-5', 'PROCESSED'),
    ]);
    render(<OpportunitySolicitationDocuments />);

    expect(screen.getByText('doc-1.pdf')).toBeTruthy();
    expect(screen.getByText('doc-3.pdf')).toBeTruthy();
    expect(screen.queryByText('doc-4.pdf')).toBeNull();

    const toggle = screen.getByRole('button', { name: /show all \(5\)/i });
    fireEvent.click(toggle);

    expect(screen.getByText('doc-4.pdf')).toBeTruthy();
    expect(screen.getByText('doc-5.pdf')).toBeTruthy();

    const showLess = screen.getByRole('button', { name: /show less/i });
    fireEvent.click(showLess);
    expect(screen.queryByText('doc-4.pdf')).toBeNull();
  });

  it('keeps collapsed documents visible to smart polling via data-doc-status markers', () => {
    setFiles([
      makeFile('doc-1', 'PROCESSED'),
      makeFile('doc-2', 'PROCESSED'),
      makeFile('doc-3', 'PROCESSED'),
      makeFile('doc-4', 'PROCESSING'),
    ]);
    const { container } = render(<OpportunitySolicitationDocuments />);

    // All 4 statuses stay in the DOM even though only 3 rows render.
    const markers = container.querySelectorAll('[data-doc-status]');
    expect(markers.length).toBe(4);
    const statuses = Array.from(markers).map((el) => el.getAttribute('data-doc-status'));
    expect(statuses).toContain('PROCESSING');
  });

  it('shows no toggle when there are 3 or fewer documents', () => {
    setFiles([
      makeFile('doc-1', 'PROCESSED'),
      makeFile('doc-2', 'PROCESSED'),
      makeFile('doc-3', 'PROCESSED'),
    ]);
    render(<OpportunitySolicitationDocuments />);

    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull();
  });
});
