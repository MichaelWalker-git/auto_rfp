import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoiaDocumentsList } from '../FoiaDocumentsList';
import { useFoiaArtifacts } from '@/lib/hooks/use-foia-artifacts';
import type { FoiaArtifact, FOIAResponseDocument } from '@auto-rfp/core';

jest.mock('@/lib/hooks/use-foia-artifacts');
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));
jest.mock('@/components/ui/skeleton', () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));
jest.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <button onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
      {children}
    </button>
  ),
}));

const mockUseFoiaArtifacts = useFoiaArtifacts as jest.MockedFunction<typeof useFoiaArtifacts>;

describe('FoiaDocumentsList', () => {
  const defaultProps = {
    orgId: 'org-123',
    projectId: 'proj-456',
    opportunityId: 'opp-789',
  };

  const mockGetDownloadUrl = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFoiaArtifacts.mockReturnValue({
      getDownloadUrl: mockGetDownloadUrl,
      isLoading: false,
    });
  });

  it('renders loading state', () => {
    render(<FoiaDocumentsList {...defaultProps} isLoading={true} />);

    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders empty state for both groups when no documents', () => {
    render(<FoiaDocumentsList {...defaultProps} artifacts={[]} responseDocuments={[]} />);

    expect(screen.getByText('Request documents')).toBeInTheDocument();
    expect(
      screen.getByText('Documents appear here once the request is prepared and approved.')
    ).toBeInTheDocument();

    expect(screen.getByText('Agency response')).toBeInTheDocument();
    expect(
      screen.getByText('Upload what the agency sends back. Response documents will appear here.')
    ).toBeInTheDocument();
  });

  it('renders request documents with correct file types', () => {
    const artifacts: FoiaArtifact[] = [
      {
        kind: 'LETTER_TXT',
        s3Key: 'key1',
        fileName: 'letter.txt',
        contentType: 'text/plain',
        sizeBytes: 1024,
        createdAt: '2024-01-15T10:00:00Z',
      },
      {
        kind: 'LETTER_PDF',
        s3Key: 'key2',
        fileName: 'letter.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        createdAt: '2024-01-15T10:00:00Z',
      },
      {
        kind: 'EML',
        s3Key: 'key3',
        fileName: 'request.eml',
        contentType: 'message/rfc822',
        sizeBytes: 512,
        createdAt: '2024-01-15T10:00:00Z',
      },
    ];

    render(<FoiaDocumentsList {...defaultProps} artifacts={artifacts} />);

    expect(screen.getByText('letter.txt')).toBeInTheDocument();
    expect(screen.getByText('letter.pdf')).toBeInTheDocument();
    expect(screen.getByText('request.eml')).toBeInTheDocument();

    // Check formatted sizes
    expect(screen.getByText('1.0 KB')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('512 B')).toBeInTheDocument();

    // Check dates
    const dates = screen.getAllByText('Jan 15, 2024');
    expect(dates.length).toBe(3);
  });

  it('renders agency response documents', () => {
    const responseDocuments: FOIAResponseDocument[] = [
      {
        s3Key: 'response-key1',
        fileName: 'response.pdf',
        contentType: 'application/pdf',
        sizeBytes: 5120,
        uploadedAt: '2024-01-20T14:30:00Z',
        uploadedBy: 'user-123',
      },
    ];

    render(<FoiaDocumentsList {...defaultProps} responseDocuments={responseDocuments} />);

    expect(screen.getByText('response.pdf')).toBeInTheDocument();
    expect(screen.getByText('5.0 KB')).toBeInTheDocument();
    expect(screen.getByText('Jan 20, 2024')).toBeInTheDocument();
    expect(screen.getByText(/by user-123/)).toBeInTheDocument();
  });

  it('calls getDownloadUrl and opens URL when download button clicked', async () => {
    const user = userEvent.setup();
    const mockUrl = 'https://s3.amazonaws.com/presigned-url';
    mockGetDownloadUrl.mockResolvedValue(mockUrl);

    const artifacts: FoiaArtifact[] = [
      {
        kind: 'LETTER_PDF',
        s3Key: 'key1',
        fileName: 'letter.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        createdAt: '2024-01-15T10:00:00Z',
      },
    ];

    const mockWindowOpen = jest.fn();
    global.window.open = mockWindowOpen;

    render(<FoiaDocumentsList {...defaultProps} artifacts={artifacts} />);

    const downloadButton = screen.getByLabelText('Download letter.pdf');
    await user.click(downloadButton);

    await waitFor(() => {
      expect(mockGetDownloadUrl).toHaveBeenCalledWith(artifacts[0]);
      expect(mockWindowOpen).toHaveBeenCalledWith(mockUrl, '_blank');
    });
  });

  it('formats file sizes correctly', () => {
    const artifacts: FoiaArtifact[] = [
      {
        kind: 'LETTER_TXT',
        s3Key: 'key1',
        fileName: 'small.txt',
        contentType: 'text/plain',
        sizeBytes: 512,
        createdAt: '2024-01-15T10:00:00Z',
      },
      {
        kind: 'LETTER_PDF',
        s3Key: 'key2',
        fileName: 'medium.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1024 * 500, // 500 KB
        createdAt: '2024-01-15T10:00:00Z',
      },
      {
        kind: 'EML',
        s3Key: 'key3',
        fileName: 'large.eml',
        contentType: 'message/rfc822',
        sizeBytes: 1024 * 1024 * 2.5, // 2.5 MB
        createdAt: '2024-01-15T10:00:00Z',
      },
    ];

    render(<FoiaDocumentsList {...defaultProps} artifacts={artifacts} />);

    expect(screen.getByText('512 B')).toBeInTheDocument();
    expect(screen.getByText('500.0 KB')).toBeInTheDocument();
    expect(screen.getByText('2.5 MB')).toBeInTheDocument();
  });

  it('separates request documents from agency response', () => {
    const artifacts: FoiaArtifact[] = [
      {
        kind: 'LETTER_TXT',
        s3Key: 'key1',
        fileName: 'letter.txt',
        contentType: 'text/plain',
        sizeBytes: 1024,
        createdAt: '2024-01-15T10:00:00Z',
      },
      {
        kind: 'AGENCY_RESPONSE',
        s3Key: 'key2',
        fileName: 'agency-docs.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2048,
        createdAt: '2024-01-20T14:00:00Z',
        uploadedBy: 'user-456',
      },
    ];

    render(<FoiaDocumentsList {...defaultProps} artifacts={artifacts} />);

    // Both headings should be present
    expect(screen.getByText('Request documents')).toBeInTheDocument();
    expect(screen.getByText('Agency response')).toBeInTheDocument();

    // Both documents render, in their respective groups.
    expect(screen.getByText('letter.txt')).toBeInTheDocument();
    expect(screen.getByText('agency-docs.pdf')).toBeInTheDocument();

    // Only the agency response carries an uploader, since only a human uploads
    // one — the request artifacts are machine-generated. Exactly one such label.
    expect(screen.getAllByText(/by user-456/)).toHaveLength(1);
  });
});
