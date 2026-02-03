import { render, screen, fireEvent } from '@testing-library/react';
import { DebriefingCard } from '../DebriefingCard';

// Mock the hooks
const mockDebriefing = {
  id: 'debrief-1',
  projectId: 'proj-123',
  orgId: 'org-456',
  status: 'REQUESTED' as const,
  requestDate: '2025-01-15T00:00:00Z',
  requestDeadline: '2025-01-20T00:00:00Z',
  requestedBy: 'user-789',
  contactEmail: 'co@agency.gov',
  contactName: 'John Smith',
};

const mockRefetch = jest.fn();
let mockUseDebriefingsReturn = {
  debriefings: [] as typeof mockDebriefing[],
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

describe('DebriefingCard', () => {
  const defaultProps = {
    projectId: 'proj-123',
    orgId: 'org-456',
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
    it('shows skeleton when loading', () => {
      mockUseDebriefingsReturn.isLoading = true;

      const { container } = render(<DebriefingCard {...defaultProps} />);
      const skeleton = container.querySelector('.animate-pulse');
      expect(skeleton).toBeInTheDocument();
    });
  });

  describe('no debriefing state', () => {
    it('shows empty message when no debriefings', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('No debriefing requested yet')).toBeInTheDocument();
    });

    it('shows Request Debriefing buttons', () => {
      render(<DebriefingCard {...defaultProps} />);
      // There are two buttons - one in header, one in content
      const buttons = screen.getAllByRole('button', { name: /request debriefing/i });
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('with debriefing', () => {
    beforeEach(() => {
      mockUseDebriefingsReturn.debriefings = [mockDebriefing];
    });

    it('shows debriefing status badge', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('Requested')).toBeInTheDocument();
    });

    it('shows contact name', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('John Smith')).toBeInTheDocument();
    });

    it('shows contact email', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('co@agency.gov')).toBeInTheDocument();
    });

    it('does not show Request Debriefing button in header when debriefing exists', () => {
      render(<DebriefingCard {...defaultProps} />);
      // There should be no button in header (only the status badge)
      const header = screen.getByText('Debriefing').closest('div');
      const headerButton = header?.querySelector('button');
      expect(headerButton).toBeNull();
    });
  });

  describe('completed debriefing', () => {
    const completedDebriefing = {
      ...mockDebriefing,
      status: 'COMPLETED' as const,
      findings: 'Price was the determining factor',
    };

    beforeEach(() => {
      mockUseDebriefingsReturn.debriefings = [completedDebriefing];
    });

    it('shows Completed badge', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('Completed')).toBeInTheDocument();
    });

    it('shows findings summary', () => {
      render(<DebriefingCard {...defaultProps} />);
      expect(screen.getByText('Key Findings:')).toBeInTheDocument();
      expect(screen.getByText('Price was the determining factor')).toBeInTheDocument();
    });
  });

  describe('dialog interaction', () => {
    it('opens dialog when Request Debriefing button is clicked', () => {
      render(<DebriefingCard {...defaultProps} />);

      // Click the first Request Debriefing button
      const buttons = screen.getAllByRole('button', { name: /request debriefing/i });
      fireEvent.click(buttons[0]);

      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });
  });
});
