import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CreateFOIARequestDialog } from '../CreateFOIARequestDialog';
import type { FOIARequestItem } from '@auto-rfp/core';

// Mock @auto-rfp/core
jest.mock('@auto-rfp/core', () => ({
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

const mockCreateFOIARequest = jest.fn();
const mockToast = jest.fn();

jest.mock('@/lib/hooks/use-foia-requests', () => ({
  useCreateFOIARequest: () => ({
    createFOIARequest: mockCreateFOIARequest,
  }),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: mockToast,
  }),
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

// Mock Checkbox to avoid Radix portal issues
jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: () => void }) => (
    <input
      type="checkbox"
      id={id}
      data-testid={`checkbox-${id}`}
      checked={checked}
      onChange={onCheckedChange}
    />
  ),
}));

describe('CreateFOIARequestDialog', () => {
  const defaultProps = {
    isOpen: true,
    onOpenChange: jest.fn(),
    projectId: 'proj-123',
    orgId: 'org-456',
  };

  const mockFOIARequest: FOIARequestItem = {
    id: 'foia-1',
    projectId: 'proj-123',
    orgId: 'org-456',
    status: 'DRAFT',
    agencyName: 'Department of Defense',
    solicitationNumber: 'W911NF-21-R-0001',
    requestedDocuments: ['SSEB_REPORT'],
    requesterName: 'John Doe',
    requesterEmail: 'john@company.com',
    requestedBy: 'user-789',
    createdAt: '2025-01-15T00:00:00Z',
    updatedAt: '2025-01-15T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateFOIARequest.mockResolvedValue(mockFOIARequest);
  });

  describe('rendering', () => {
    it('renders dialog when isOpen is true', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByTestId('dialog')).toBeInTheDocument();
    });

    it('does not render dialog when isOpen is false', () => {
      render(<CreateFOIARequestDialog {...defaultProps} isOpen={false} />);
      expect(screen.queryByTestId('dialog')).not.toBeInTheDocument();
    });

    it('shows dialog title', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByTestId('dialog-title')).toHaveTextContent('Create FOIA Request');
    });

    it('shows agency information section', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByText('Agency Information')).toBeInTheDocument();
    });

    it('shows contract information section', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByText('Contract Information')).toBeInTheDocument();
    });

    it('shows documents to request section', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByText('Documents to Request *')).toBeInTheDocument();
    });

    it('shows contact information section', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByText('Your Contact Information')).toBeInTheDocument();
    });
  });

  describe('form fields', () => {
    it('renders agency name input', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByLabelText(/agency name/i)).toBeInTheDocument();
    });

    it('renders FOIA office email input', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByLabelText(/foia office email/i)).toBeInTheDocument();
    });

    it('renders solicitation number input', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByLabelText(/solicitation number/i)).toBeInTheDocument();
    });

    it('renders requester name input', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByLabelText(/^name \*/i)).toBeInTheDocument();
    });

    it('renders requester email input', () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);
      expect(screen.getByLabelText(/^email \*/i)).toBeInTheDocument();
    });

    it('pre-fills agency name when provided', () => {
      render(
        <CreateFOIARequestDialog
          {...defaultProps}
          agencyName="Department of Defense"
        />
      );
      const input = screen.getByLabelText(/agency name/i) as HTMLInputElement;
      expect(input.value).toBe('Department of Defense');
    });

    it('pre-fills solicitation number when provided', () => {
      render(
        <CreateFOIARequestDialog
          {...defaultProps}
          solicitationNumber="W911NF-21-R-0001"
        />
      );
      const input = screen.getByLabelText(/solicitation number/i) as HTMLInputElement;
      expect(input.value).toBe('W911NF-21-R-0001');
    });
  });

  describe('form submission', () => {
    it('does not call createFOIARequest when no documents are selected', async () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);

      // Fill required HTML fields but not documents
      fireEvent.change(screen.getByLabelText(/agency name/i), {
        target: { value: 'Department of Defense' },
      });
      fireEvent.change(screen.getByLabelText(/solicitation number/i), {
        target: { value: 'W911NF-21-R-0001' },
      });
      fireEvent.change(screen.getByLabelText(/^name \*/i), {
        target: { value: 'John Doe' },
      });
      fireEvent.change(screen.getByLabelText(/^email \*/i), {
        target: { value: 'john@company.com' },
      });

      const submitButton = screen.getByRole('button', { name: /create foia request/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            description: expect.stringContaining('document'),
            variant: 'destructive',
          })
        );
      });

      expect(mockCreateFOIARequest).not.toHaveBeenCalled();
    });

    it('calls createFOIARequest on successful submission', async () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);

      // Fill required fields
      fireEvent.change(screen.getByLabelText(/agency name/i), {
        target: { value: 'Department of Defense' },
      });
      fireEvent.change(screen.getByLabelText(/solicitation number/i), {
        target: { value: 'W911NF-21-R-0001' },
      });
      fireEvent.change(screen.getByLabelText(/^name \*/i), {
        target: { value: 'John Doe' },
      });
      fireEvent.change(screen.getByLabelText(/^email \*/i), {
        target: { value: 'john@company.com' },
      });

      // Select a document
      const checkbox = screen.getByTestId('checkbox-SSEB_REPORT');
      fireEvent.click(checkbox);

      const submitButton = screen.getByRole('button', { name: /create foia request/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockCreateFOIARequest).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: 'proj-123',
            orgId: 'org-456',
            agencyName: 'Department of Defense',
            solicitationNumber: 'W911NF-21-R-0001',
            requesterName: 'John Doe',
            requesterEmail: 'john@company.com',
            requestedDocuments: ['SSEB_REPORT'],
          })
        );
      });
    });

    it('shows success toast on successful submission', async () => {
      render(<CreateFOIARequestDialog {...defaultProps} />);

      // Fill required fields
      fireEvent.change(screen.getByLabelText(/agency name/i), {
        target: { value: 'Department of Defense' },
      });
      fireEvent.change(screen.getByLabelText(/solicitation number/i), {
        target: { value: 'W911NF-21-R-0001' },
      });
      fireEvent.change(screen.getByLabelText(/^name \*/i), {
        target: { value: 'John Doe' },
      });
      fireEvent.change(screen.getByLabelText(/^email \*/i), {
        target: { value: 'john@company.com' },
      });

      // Select a document
      const checkbox = screen.getByTestId('checkbox-SSEB_REPORT');
      fireEvent.click(checkbox);

      const submitButton = screen.getByRole('button', { name: /create foia request/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'FOIA Request Created',
          })
        );
      });
    });

    it('calls onOpenChange(false) after successful submission', async () => {
      const onOpenChange = jest.fn();
      render(<CreateFOIARequestDialog {...defaultProps} onOpenChange={onOpenChange} />);

      // Fill required fields
      fireEvent.change(screen.getByLabelText(/agency name/i), {
        target: { value: 'Department of Defense' },
      });
      fireEvent.change(screen.getByLabelText(/solicitation number/i), {
        target: { value: 'W911NF-21-R-0001' },
      });
      fireEvent.change(screen.getByLabelText(/^name \*/i), {
        target: { value: 'John Doe' },
      });
      fireEvent.change(screen.getByLabelText(/^email \*/i), {
        target: { value: 'john@company.com' },
      });

      // Select a document
      const checkbox = screen.getByTestId('checkbox-SSEB_REPORT');
      fireEvent.click(checkbox);

      const submitButton = screen.getByRole('button', { name: /create foia request/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('calls onSuccess callback after successful submission', async () => {
      const onSuccess = jest.fn();
      render(<CreateFOIARequestDialog {...defaultProps} onSuccess={onSuccess} />);

      // Fill required fields
      fireEvent.change(screen.getByLabelText(/agency name/i), {
        target: { value: 'Department of Defense' },
      });
      fireEvent.change(screen.getByLabelText(/solicitation number/i), {
        target: { value: 'W911NF-21-R-0001' },
      });
      fireEvent.change(screen.getByLabelText(/^name \*/i), {
        target: { value: 'John Doe' },
      });
      fireEvent.change(screen.getByLabelText(/^email \*/i), {
        target: { value: 'john@company.com' },
      });

      // Select a document
      const checkbox = screen.getByTestId('checkbox-SSEB_REPORT');
      fireEvent.click(checkbox);

      const submitButton = screen.getByRole('button', { name: /create foia request/i });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(mockFOIARequest);
      });
    });
  });

  describe('cancel button', () => {
    it('calls onOpenChange(false) when cancel button is clicked', () => {
      const onOpenChange = jest.fn();
      render(<CreateFOIARequestDialog {...defaultProps} onOpenChange={onOpenChange} />);

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);

      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
