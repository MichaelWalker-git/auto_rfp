import { render, screen, fireEvent } from '@testing-library/react';
import { FOIARequestCard } from '../FOIARequestCard';
import type { FOIARequestItem } from '@auto-rfp/shared';

// Mock @auto-rfp/shared
jest.mock('@auto-rfp/shared', () => ({
  FOIA_DOCUMENT_TYPES: [
    'SSEB_REPORT',
    'SSDD',
    'TECHNICAL_EVAL',
    'PRICE_ANALYSIS',
    'PAST_PERFORMANCE_EVAL',
  ],
  FOIA_DOCUMENT_DESCRIPTIONS: {
    SSEB_REPORT: 'Source Selection Evaluation Board (SSEB) Report',
    SSDD: 'Source Selection Decision Document (SSDD)',
    TECHNICAL_EVAL: 'Technical Evaluation Documentation',
    PRICE_ANALYSIS: 'Price/Cost Analysis',
    PAST_PERFORMANCE_EVAL: 'Past Performance Evaluation',
    PROPOSAL_ABSTRACT: 'Proposal Abstract or Executive Summary',
    DEBRIEFING_NOTES: 'Debriefing Notes or Documentation',
    CORRESPONDENCE: 'Relevant Correspondence',
    AWARD_NOTICE: 'Award Notice and Supporting Documentation',
    OTHER: 'Other Relevant Documentation',
  },
}));

// Mock the hooks
const mockFOIARequest: FOIARequestItem = {
  id: 'foia-1',
  projectId: 'proj-123',
  orgId: 'org-456',
  status: 'DRAFT',
  agencyName: 'Department of Defense',
  agencyFOIAEmail: 'foia@dod.gov',
  solicitationNumber: 'W911NF-21-R-0001',
  requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL'],
  requesterName: 'John Doe',
  requesterEmail: 'john@company.com',
  requestedBy: 'user-789',
  createdAt: '2025-01-15T00:00:00Z',
  updatedAt: '2025-01-15T00:00:00Z',
};

const mockRefetch = jest.fn();
let mockUseFOIARequestsReturn = {
  foiaRequests: [] as FOIARequestItem[],
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: mockRefetch,
};

jest.mock('@/lib/hooks/use-foia-requests', () => ({
  useFOIARequests: () => mockUseFOIARequestsReturn,
  useCreateFOIARequest: () => ({
    createFOIARequest: jest.fn().mockResolvedValue(mockFOIARequest),
  }),
  useGenerateFOIALetter: () => ({
    generateFOIALetter: jest.fn().mockResolvedValue('Generated FOIA letter content'),
  }),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

jest.mock('@/components/permission-wrapper', () => ({
  PermissionWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock Dialog to avoid portal issues
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
  DialogFooter: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-footer">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
}));

describe('FOIARequestCard', () => {
  const defaultProps = {
    projectId: 'proj-123',
    orgId: 'org-456',
    projectOutcomeStatus: 'LOST',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFOIARequestsReturn = {
      foiaRequests: [],
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    };
  });

  describe('rendering conditions', () => {
    it('returns null when project outcome is not LOST', () => {
      const { container } = render(
        <FOIARequestCard {...defaultProps} projectOutcomeStatus="WON" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders when project outcome is LOST', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('FOIA Requests')).toBeInTheDocument();
    });

    it('returns null when project outcome is PENDING', () => {
      const { container } = render(
        <FOIARequestCard {...defaultProps} projectOutcomeStatus="PENDING" />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe('loading state', () => {
    it('shows skeleton when loading', () => {
      mockUseFOIARequestsReturn.isLoading = true;

      const { container } = render(<FOIARequestCard {...defaultProps} />);
      const skeleton = container.querySelector('.animate-pulse');
      expect(skeleton).toBeInTheDocument();
    });
  });

  describe('no FOIA requests state', () => {
    it('shows empty message when no FOIA requests', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('No FOIA requests yet')).toBeInTheDocument();
    });

    it('shows Create FOIA Request button in content', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByRole('button', { name: /create foia request/i })).toBeInTheDocument();
    });

    it('shows New FOIA Request button in header', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByRole('button', { name: /new foia request/i })).toBeInTheDocument();
    });
  });

  describe('with FOIA request', () => {
    beforeEach(() => {
      mockUseFOIARequestsReturn.foiaRequests = [mockFOIARequest];
    });

    it('shows FOIA status badge', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });

    it('shows agency name', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('Department of Defense')).toBeInTheDocument();
    });

    it('shows requested documents section', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('Requested Documents:')).toBeInTheDocument();
    });

    it('shows View Letter button', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByRole('button', { name: /view letter/i })).toBeInTheDocument();
    });

    it('shows Email Agency link when email is provided', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByRole('link', { name: /email agency/i })).toBeInTheDocument();
    });
  });

  describe('FOIA request with tracking number', () => {
    const requestWithTracking = {
      ...mockFOIARequest,
      status: 'SUBMITTED' as const,
      trackingNumber: 'FOIA-2025-001234',
    };

    beforeEach(() => {
      mockUseFOIARequestsReturn.foiaRequests = [requestWithTracking];
    });

    it('shows tracking number', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText(/Tracking: FOIA-2025-001234/)).toBeInTheDocument();
    });

    it('shows Submitted badge', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('Submitted')).toBeInTheDocument();
    });
  });

  describe('FOIA request with response', () => {
    const requestWithResponse = {
      ...mockFOIARequest,
      status: 'RESPONSE_RECEIVED' as const,
      responseNotes: 'Partial documents received',
    };

    beforeEach(() => {
      mockUseFOIARequestsReturn.foiaRequests = [requestWithResponse];
    });

    it('shows Response Received badge', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('Response Received')).toBeInTheDocument();
    });

    it('shows response notes', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('Response Notes:')).toBeInTheDocument();
      expect(screen.getByText('Partial documents received')).toBeInTheDocument();
    });
  });

  describe('multiple FOIA requests', () => {
    const secondRequest: FOIARequestItem = {
      ...mockFOIARequest,
      id: 'foia-2',
      status: 'CLOSED',
      createdAt: '2025-01-10T00:00:00Z',
    };

    beforeEach(() => {
      mockUseFOIARequestsReturn.foiaRequests = [mockFOIARequest, secondRequest];
    });

    it('shows expand button for multiple requests', () => {
      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByRole('button', { name: /show 1 more request/i })).toBeInTheDocument();
    });

    it('expands to show all requests when clicked', () => {
      render(<FOIARequestCard {...defaultProps} />);

      const expandButton = screen.getByRole('button', { name: /show 1 more request/i });
      fireEvent.click(expandButton);

      // After expanding, both should be visible
      expect(screen.getByText('Closed')).toBeInTheDocument();
    });
  });

  describe('dialog interaction', () => {
    it('opens create dialog when New FOIA Request button is clicked', () => {
      render(<FOIARequestCard {...defaultProps} />);

      const button = screen.getByRole('button', { name: /new foia request/i });
      fireEvent.click(button);

      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });

    it('opens letter preview dialog when View Letter button is clicked', () => {
      mockUseFOIARequestsReturn.foiaRequests = [mockFOIARequest];
      render(<FOIARequestCard {...defaultProps} />);

      const viewLetterButton = screen.getByRole('button', { name: /view letter/i });
      fireEvent.click(viewLetterButton);

      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });
  });
});
