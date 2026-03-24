import { render, screen, fireEvent } from '@testing-library/react';
import { DebriefingCard } from '../DebriefingCard';
import type { DebriefingItem } from '@auto-rfp/core';

// Mock the hooks
const mockDebriefing: DebriefingItem = {
  debriefId: 'debrief-1',
  projectId: 'proj-123',
  orgId: 'org-456',
  opportunityId: 'opp-789',
  solicitationNumber: 'W911NF-21-R-0001',
  contractTitle: 'IT Services Contract',
  awardNotificationDate: '2025-01-10',
  contractingOfficerName: 'Jane Doe',
  contractingOfficerEmail: 'jane.doe@agency.gov',
  requesterName: 'John Smith',
  requesterTitle: 'Contracts Manager',
  requesterEmail: 'john@company.com',
  requesterPhone: '555-123-4567',
  requesterAddress: '123 Business Ave, Arlington VA 22201',
  companyName: 'Acme Corp',
  createdAt: '2025-01-15T00:00:00+00:00',
  createdBy: 'user-789',
  updatedAt: '2025-01-15T00:00:00+00:00',
};

const mockRefetch = jest.fn();
const mockGenerateDebriefingLetter = jest.fn().mockResolvedValue('Dear Sir/Madam...');
let mockUseDebriefingsReturn = {
  debriefings: [] as DebriefingItem[],
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: mockRefetch,
};

jest.mock('@/lib/hooks/use-debriefing', () => ({
  useDebriefings: () => mockUseDebriefingsReturn,
  useCreateDebriefing: () => ({
    createDebriefing: jest.fn().mockResolvedValue(mockDebriefing),
  }),
  useUpdateDebriefing: () => ({
    updateDebriefing: jest.fn().mockResolvedValue(mockDebriefing),
  }),
  useGenerateDebriefingLetter: () => ({
    generateDebriefingLetter: mockGenerateDebriefingLetter,
  }),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

jest.mock('@/components/permission-wrapper', () => {
  const PermissionWrapper = ({ children }: { children: React.ReactNode }) => <>{children}</>;
  return {
    __esModule: true,
    default: PermissionWrapper,
    PermissionWrapper,
  };
});

// Mock org hooks used by RequestDebriefingDialog
jest.mock('@/lib/hooks/use-org-contact', () => ({
  useOrgPrimaryContact: () => ({
    data: {
      contact: {
        name: 'Jane Smith',
        email: 'jane@acme.com',
        title: 'Contracts Manager',
        address: '123 Business Ave',
      },
    },
  }),
}));

jest.mock('@/context/organization-context', () => ({
  useCurrentOrganization: () => ({
    currentOrganization: { id: 'org-456', name: 'Acme Corp' },
    organizations: [],
    setCurrentOrganization: jest.fn(),
  }),
}));

// Mock RequestDebriefingDialog to avoid deep dependency issues
jest.mock('../RequestDebriefingDialog', () => ({
  RequestDebriefingDialog: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="request-debriefing-dialog">Request Dialog</div> : null,
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

describe('DebriefingCard', () => {
  const defaultProps = {
    projectId: 'proj-123',
    orgId: 'org-456',
    opportunityId: 'opp-789',
    projectOutcomeStatus: 'LOST',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseDebriefingsReturn = {
      debriefings: [],
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    };
  });

  describe('rendering conditions', () => {
    it('returns null when project outcome is not LOST', () => {
      const { container } = render(
        <DebriefingCard {...defaultProps} projectOutcomeStatus="WON" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders when project outcome is LOST', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('Debriefing')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('renders loading skeleton', () => {
      mockUseDebriefingsReturn.isLoading = true;

      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('Debriefing')).toBeInTheDocument();
    });
  });

  describe('no debriefing state', () => {
    it('shows empty message when no debriefings', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('No debriefing requested yet')).toBeInTheDocument();
    });

    it('shows Request Debriefing buttons', () => {
      render(<DebriefingCard {...defaultProps} />);
      const buttons = screen.getAllByRole('button', { name: /request debriefing/i });
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('with debriefing', () => {
    beforeEach(() => {
      mockUseDebriefingsReturn.debriefings = [mockDebriefing];
    });

    it('shows Draft Letter button', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByRole('button', { name: /Draft Letter/ })).toBeInTheDocument();
    });

    it('shows created date', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText(/Created.*ago/)).toBeInTheDocument();
    });

    it('does not show Request button in header when debriefing exists', () => {
      render(<DebriefingCard {...defaultProps} />);
      const header = screen.getByText('Debriefing').closest('div');
      const headerButton = header?.querySelector('button');
      expect(headerButton).toBeNull();
    });
  });

  describe('with solicitation/contract details', () => {
    beforeEach(() => {
      mockUseDebriefingsReturn.debriefings = [{
        ...mockDebriefing,
        solicitationNumber: 'W911NF-21-R-0001',
        awardedOrganization: 'Winning Contractor LLC',
        contractingOfficerName: 'Jane Doe',
        contractingOfficerEmail: 'jane.doe@agency.gov',
      }];
    });

    it('shows solicitation number', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText(/Solicitation: W911NF-21-R-0001/)).toBeInTheDocument();
    });

    it('shows awarded organization', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText(/Awardee: Winning Contractor LLC/)).toBeInTheDocument();
    });

    it('shows contracting officer info', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('jane.doe@agency.gov')).toBeInTheDocument();
    });
  });

  describe('draft letter interaction', () => {
    it('calls generateDebriefingLetter when Draft Letter is clicked', () => {
      mockUseDebriefingsReturn.debriefings = [mockDebriefing];

      render(<DebriefingCard {...defaultProps} />);

      const draftButton = screen.getByRole('button', { name: /Draft Letter/ });
      fireEvent.click(draftButton);

      expect(mockGenerateDebriefingLetter).toHaveBeenCalledWith(
        'org-456',
        'proj-123',
        'opp-789',
        'debrief-1'
      );
    });
  });

  describe('dialog interaction', () => {
    it('opens dialog when Request Debriefing button is clicked', () => {
      render(<DebriefingCard {...defaultProps} />);

      const buttons = screen.getAllByRole('button', { name: /request debriefing/i });
      fireEvent.click(buttons[0]);

      expect(screen.getByTestId('request-debriefing-dialog')).toBeInTheDocument();
    });
  });
});
