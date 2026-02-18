import { render, screen, fireEvent } from '@testing-library/react';
import { SetProjectOutcomeDialog } from '../SetProjectOutcomeDialog';

// Mock the hooks
const mockSetOutcome = jest.fn().mockResolvedValue({
  projectId: 'proj-123',
  orgId: 'org-456',
  status: 'WON',
});

jest.mock('@/lib/hooks/use-set-project-outcome', () => ({
  useSetProjectOutcome: () => ({
    setOutcome: mockSetOutcome,
    isSubmitting: false,
  }),
}));

// Mock useToast
const mockToast = jest.fn();
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
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

// Mock the Select components
jest.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
    <div data-testid="select">{children}</div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <button data-testid="select-trigger">{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span data-testid="select-value">{placeholder}</span>
  ),
}));

describe('SetProjectOutcomeDialog', () => {
  const defaultProps = {
    isOpen: true,
    onOpenChange: jest.fn(),
    projectId: 'proj-123',
    orgId: 'org-456',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('dialog rendering', () => {
    it('renders dialog when open', () => {
      render(<SetProjectOutcomeDialog {...defaultProps} />);
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });

    it('does not render dialog when closed', () => {
      render(<SetProjectOutcomeDialog {...defaultProps} isOpen={false} />);
      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
    });

    it('renders dialog title', () => {
      render(<SetProjectOutcomeDialog {...defaultProps} />);
      expect(screen.getByTestId('dialog-title')).toHaveTextContent('Set Project Outcome');
    });

    it('renders outcome status label', () => {
      render(<SetProjectOutcomeDialog {...defaultProps} />);
      expect(screen.getByText('Outcome Status')).toBeInTheDocument();
    });

    it('renders cancel button', () => {
      render(<SetProjectOutcomeDialog {...defaultProps} />);
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('renders save button', () => {
      render(<SetProjectOutcomeDialog {...defaultProps} />);
      expect(screen.getByRole('button', { name: /save outcome/i })).toBeInTheDocument();
    });
  });

  describe('form behavior', () => {
    it('calls onOpenChange with false when cancel is clicked', () => {
      const onOpenChange = jest.fn();
      render(<SetProjectOutcomeDialog {...defaultProps} onOpenChange={onOpenChange} />);

      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
