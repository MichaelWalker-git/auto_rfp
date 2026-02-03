import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectOutcomeCard } from '../ProjectOutcomeCard';

// Mock the hooks
const mockOutcome = {
  projectId: 'proj-123',
  orgId: 'org-456',
  status: 'WON' as const,
  statusDate: '2025-01-15T00:00:00Z',
  statusSetBy: 'user-789',
  statusSource: 'MANUAL' as const,
  winData: {
    contractValue: 1500000,
    contractNumber: 'GS-35F-0001',
    awardDate: '2025-01-15T00:00:00Z',
    keyFactors: 'Strong technical approach',
  },
};

const mockRefetch = jest.fn();
let mockUseProjectOutcomeReturn = {
  outcome: null as typeof mockOutcome | null,
  isLoading: false,
  isError: false,
  error: undefined,
  refetch: mockRefetch,
};

jest.mock('@/lib/hooks/use-project-outcome', () => ({
  useProjectOutcome: () => mockUseProjectOutcomeReturn,
}));

jest.mock('@/lib/hooks/use-set-project-outcome', () => ({
  useSetProjectOutcome: () => ({
    setOutcome: jest.fn().mockResolvedValue(mockOutcome),
    isSubmitting: false,
  }),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

// Mock PermissionWrapper to always show children
jest.mock('@/components/permission-wrapper', () => ({
  PermissionWrapper: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock the Dialog to avoid portal issues
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

// Mock Select components
jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="select-trigger">{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

describe('ProjectOutcomeCard', () => {
  const defaultProps = {
    projectId: 'proj-123',
    orgId: 'org-456',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProjectOutcomeReturn = {
      outcome: null,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    };
  });

  describe('loading state', () => {
    it('renders skeleton when loading', () => {
      mockUseProjectOutcomeReturn.isLoading = true;

      const { container } = render(<ProjectOutcomeCard {...defaultProps} />);
      // Check for skeleton (animated element)
      const skeleton = container.querySelector('.animate-pulse');
      expect(skeleton).toBeInTheDocument();
    });
  });

  describe('no outcome state', () => {
    it('shows no outcome message when outcome is null', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('No outcome recorded yet')).toBeInTheDocument();
    });

    it('shows Set Outcome buttons when no outcome', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      // There are two "Set Outcome" buttons - one in header, one in content
      const buttons = screen.getAllByRole('button', { name: /set outcome/i });
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  describe('with WON outcome', () => {
    beforeEach(() => {
      mockUseProjectOutcomeReturn.outcome = mockOutcome;
    });

    it('renders outcome badge with correct status', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('Won')).toBeInTheDocument();
    });

    it('shows contract value for won outcomes', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('$1,500,000')).toBeInTheDocument();
    });

    it('shows contract number for won outcomes', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('GS-35F-0001')).toBeInTheDocument();
    });

    it('shows key factors for won outcomes', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('Strong technical approach')).toBeInTheDocument();
    });

    it('shows Update button when outcome exists', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
    });
  });

  describe('with LOST outcome', () => {
    const lostOutcome = {
      projectId: 'proj-123',
      orgId: 'org-456',
      status: 'LOST' as const,
      statusDate: '2025-01-20T00:00:00Z',
      statusSetBy: 'user-789',
      statusSource: 'MANUAL' as const,
      lossData: {
        lossReason: 'PRICE_TOO_HIGH' as const,
        lossReasonDetails: 'Our bid was 15% higher',
        winningContractor: 'Acme Corp',
      },
    };

    beforeEach(() => {
      mockUseProjectOutcomeReturn.outcome = lostOutcome;
    });

    it('renders Lost badge', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('Lost')).toBeInTheDocument();
    });

    it('shows loss reason', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('Price Too High')).toBeInTheDocument();
    });

    it('shows winning contractor', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('Won by: Acme Corp')).toBeInTheDocument();
    });

    it('shows loss details', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);
      expect(screen.getByText('Our bid was 15% higher')).toBeInTheDocument();
    });
  });

  describe('dialog interaction', () => {
    it('opens dialog when Set Outcome button is clicked', () => {
      render(<ProjectOutcomeCard {...defaultProps} />);

      // Click the first "Set Outcome" button
      const buttons = screen.getAllByRole('button', { name: /set outcome/i });
      fireEvent.click(buttons[0]);

      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });
  });
});
