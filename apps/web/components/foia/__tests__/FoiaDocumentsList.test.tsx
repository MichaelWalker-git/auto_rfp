import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoiaDocumentsList, isDownloadPermitted } from '../FoiaDocumentsList';
import { useFoiaArtifacts } from '@/lib/hooks/use-foia-artifacts';
import { usePermission } from '@/components/permission-wrapper';
import type { FoiaArtifact, FOIAResponseDocument } from '@auto-rfp/core';

jest.mock('@/lib/hooks/use-foia-artifacts');
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  usePermission: jest.fn(),
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
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
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

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
    // Default to an admin, so the tests below that are not about permissions
    // exercise the fully-rendered list.
    mockUsePermission.mockReturnValue(true);
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

  /**
   * Released records routinely name a competitor's pricing and individual evaluators.
   * This component is where the bytes actually leave S3, so the `foia:documents:read`
   * gate the dashboard applies has to hold here too — while our own outgoing letters
   * stay open, since editors legitimately need to read what was sent.
   */
  describe('released-record permission gate', () => {
    const ourLetter: FoiaArtifact = {
      kind: 'LETTER_TXT',
      s3Key: 'our-letter-key',
      fileName: 'letter.txt',
      contentType: 'text/plain',
      sizeBytes: 1024,
      createdAt: '2024-01-15T10:00:00Z',
    };

    const ourPdf: FoiaArtifact = {
      kind: 'LETTER_PDF',
      s3Key: 'our-pdf-key',
      fileName: 'letter.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
      createdAt: '2024-01-15T10:00:00Z',
    };

    const ourEml: FoiaArtifact = {
      kind: 'EML',
      s3Key: 'our-eml-key',
      fileName: 'request.eml',
      contentType: 'message/rfc822',
      sizeBytes: 512,
      createdAt: '2024-01-15T10:00:00Z',
    };

    const releasedArtifact: FoiaArtifact = {
      kind: 'AGENCY_RESPONSE',
      s3Key: 'released-key',
      fileName: 'sseb-report.pdf',
      contentType: 'application/pdf',
      sizeBytes: 4096,
      createdAt: '2024-01-20T14:00:00Z',
      uploadedBy: 'user-456',
    };

    const releasedUpload: FOIAResponseDocument = {
      s3Key: 'released-upload-key',
      fileName: 'debrief.pdf',
      contentType: 'application/pdf',
      sizeBytes: 5120,
      uploadedAt: '2024-01-20T14:30:00Z',
      uploadedBy: 'user-123',
    };

    it('lets an admin download released records', async () => {
      const user = userEvent.setup();
      mockGetDownloadUrl.mockResolvedValue('https://signed');
      global.window.open = jest.fn();

      render(
        <FoiaDocumentsList
          {...defaultProps}
          artifacts={[releasedArtifact]}
          responseDocuments={[releasedUpload]}
        />,
      );

      await user.click(screen.getByLabelText('Download sseb-report.pdf'));
      await user.click(screen.getByLabelText('Download debrief.pdf'));

      await waitFor(() => {
        expect(mockGetDownloadUrl).toHaveBeenCalledWith(releasedArtifact);
        expect(mockGetDownloadUrl).toHaveBeenCalledWith(releasedUpload);
      });
    });

    it('withholds released records without foia:documents:read', () => {
      mockUsePermission.mockReturnValue(false);

      render(
        <FoiaDocumentsList
          {...defaultProps}
          artifacts={[releasedArtifact]}
          responseDocuments={[releasedUpload]}
        />,
      );

      expect(screen.queryByText('sseb-report.pdf')).not.toBeInTheDocument();
      expect(screen.queryByText('debrief.pdf')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Download sseb-report.pdf')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Download debrief.pdf')).not.toBeInTheDocument();
    });

    /**
     * Hiding the records silently would assert the agency sent nothing back, which
     * is a different and false claim. Report the count and who can open them.
     */
    it('says an administrator is required, not that there are no documents', () => {
      mockUsePermission.mockReturnValue(false);

      render(
        <FoiaDocumentsList
          {...defaultProps}
          artifacts={[releasedArtifact]}
          responseDocuments={[releasedUpload]}
        />,
      );

      expect(screen.getByText(/limited to administrators/i)).toBeInTheDocument();
      expect(screen.getByText(/2 released records are on file/i)).toBeInTheDocument();
      expect(
        screen.queryByText('Upload what the agency sends back. Response documents will appear here.'),
      ).not.toBeInTheDocument();
    });

    it('singularizes the withheld count for one record', () => {
      mockUsePermission.mockReturnValue(false);

      render(<FoiaDocumentsList {...defaultProps} artifacts={[releasedArtifact]} />);

      expect(screen.getByText(/1 released record is on file/i)).toBeInTheDocument();
    });

    it('keeps our own outgoing letters downloadable without foia:documents:read', async () => {
      const user = userEvent.setup();
      mockUsePermission.mockReturnValue(false);
      mockGetDownloadUrl.mockResolvedValue('https://signed');
      global.window.open = jest.fn();

      render(
        <FoiaDocumentsList {...defaultProps} artifacts={[ourLetter, ourPdf, ourEml]} />,
      );

      // We wrote these; gating them would break the editor's review workflow.
      for (const artifact of [ourLetter, ourPdf, ourEml]) {
        const button = screen.getByLabelText(`Download ${artifact.fileName}`);
        expect(button).not.toBeDisabled();
        await user.click(button);
      }

      await waitFor(() => {
        expect(mockGetDownloadUrl).toHaveBeenCalledWith(ourLetter);
        expect(mockGetDownloadUrl).toHaveBeenCalledWith(ourPdf);
        expect(mockGetDownloadUrl).toHaveBeenCalledWith(ourEml);
      });
    });

    /**
     * `isDownloadPermitted` is the guard `handleDownload` consults before it touches
     * S3, so a denied released record cannot reach `getDownloadUrl` even if a row is
     * somehow rendered. Asserted on the guard directly because the denied component
     * renders no released-record button to click — the button is the affordance, this
     * is the boundary.
     */
    it('denies a released record and permits our own letters, per artifact', () => {
      expect(isDownloadPermitted(releasedArtifact, false)).toBe(false);
      expect(isDownloadPermitted(releasedUpload, false)).toBe(false);
      expect(isDownloadPermitted(releasedArtifact, true)).toBe(true);
      expect(isDownloadPermitted(releasedUpload, true)).toBe(true);

      for (const artifact of [ourLetter, ourPdf, ourEml]) {
        expect(isDownloadPermitted(artifact, false)).toBe(true);
        expect(isDownloadPermitted(artifact, true)).toBe(true);
      }
    });

    it('never fetches a download URL for a released record while denied', async () => {
      const user = userEvent.setup();
      mockUsePermission.mockReturnValue(false);
      mockGetDownloadUrl.mockResolvedValue('https://signed');
      global.window.open = jest.fn();

      render(
        <FoiaDocumentsList
          {...defaultProps}
          artifacts={[ourLetter, releasedArtifact]}
          responseDocuments={[releasedUpload]}
        />,
      );

      // Click everything the denied user can actually reach.
      for (const button of screen.getAllByRole('button')) {
        await user.click(button);
      }

      await waitFor(() => expect(mockGetDownloadUrl).toHaveBeenCalledWith(ourLetter));
      expect(mockGetDownloadUrl).not.toHaveBeenCalledWith(releasedArtifact);
      expect(mockGetDownloadUrl).not.toHaveBeenCalledWith(releasedUpload);
      expect(mockGetDownloadUrl).toHaveBeenCalledTimes(1);
    });

    it('checks the document permission, not the send permission', () => {
      // foia:send is held by EDITOR and answers a different question — the authority
      // to transmit a request. Using it here would admit every editor to the records.
      render(<FoiaDocumentsList {...defaultProps} artifacts={[releasedArtifact]} />);

      expect(mockUsePermission).toHaveBeenCalledWith('foia:documents:read');
      expect(mockUsePermission).not.toHaveBeenCalledWith('foia:send');
    });
  });
});
