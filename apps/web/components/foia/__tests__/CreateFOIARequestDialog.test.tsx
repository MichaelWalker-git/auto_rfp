import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateFOIARequestDialog } from '../CreateFOIARequestDialog';
import type { FOIARequestItem } from '@auto-rfp/core';

// Mock @auto-rfp/core — keep real schemas so zodResolver works
jest.mock('@auto-rfp/core', () => {
  const actual = jest.requireActual('@auto-rfp/core');
  return {
    ...actual,
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
  };
});

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

// Mock Input and Textarea with forwardRef so react-hook-form register() works properly
jest.mock('@/components/ui/input', () => ({
  Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
    (props, ref) => <input ref={ref} {...props} />
  ),
}));

jest.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
    (props, ref) => <textarea ref={ref} {...props} />
  ),
}));

// Mock Checkbox to avoid Radix portal issues
jest.mock('@/components/ui/checkbox', () => ({
  Checkbox: ({ id, checked, onCheckedChange }: { id: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <input
      type="checkbox"
      id={id}
      data-testid={`checkbox-${id}`}
      checked={checked}
      onChange={(e) => onCheckedChange(e.target.checked)}
    />
  ),
}));

// Helper to fill form fields and submit — uses userEvent for proper DOM + react-hook-form interaction
const fillAndSubmitForm = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/agency name/i), 'Department of Defense');
  await user.type(screen.getByLabelText(/solicitation number/i), 'W911NF-21-R-0001');
  await user.type(screen.getByLabelText(/^name \*/i), 'John Doe');
  await user.type(screen.getByLabelText(/^email \*/i), 'john@company.com');

  // Select a document
  await user.click(screen.getByTestId('checkbox-SSEB_REPORT'));

  // Submit
  await user.click(screen.getByRole('button', { name: /create foia request/i }));
};

describe('CreateFOIARequestDialog', () => {
  const defaultProps = {
    isOpen: true,
    onOpenChange: jest.fn(),
    projectId: 'proj-123',
    orgId: 'org-456',
  };

  const mockFOIARequest = {
    id: 'foia-1',
    foiaId: 'foia-1',
    projectId: 'proj-123',
    orgId: 'org-456',
    status: 'DRAFT',
    agencyName: 'Department of Defense',
    agencyId: 'agency-1',
    agencyAbbreviation: 'DoD',
    solicitationNumber: 'W911NF-21-R-0001',
    requestedDocuments: ['SSEB_REPORT'],
    requesterName: 'John Doe',
    requesterEmail: 'john@company.com',
    requesterCategory: 'OTHER',
    requestedBy: 'user-789',
    createdBy: 'user-789',
    feeLimit: 50,
    requestFeeWaiver: false,
    submissionMethod: 'MANUAL',
    letterFormat: 'STANDARD',
    createdAt: '2025-01-15T00:00:00Z',
    updatedAt: '2025-01-15T00:00:00Z',
  } as unknown as FOIARequestItem;

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

    it('pre-fills agency name when provided', async () => {
      const user = userEvent.setup();
      render(
        <CreateFOIARequestDialog
          {...defaultProps}
          agencyName="Department of Defense"
        />
      );
      // Verify the agency name is pre-filled by submitting and checking the value
      // (react-hook-form defaultValues are in internal state, not always reflected in DOM without forwardRef)
      const input = screen.getByLabelText(/agency name/i) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      // Fill remaining required fields and submit to verify the default value is used
      await user.type(screen.getByLabelText(/solicitation number/i), 'W911NF-21-R-0001');
      await user.type(screen.getByLabelText(/^name \*/i), 'John Doe');
      await user.type(screen.getByLabelText(/^email \*/i), 'john@company.com');
      await user.click(screen.getByTestId('checkbox-SSEB_REPORT'));
      await user.click(screen.getByRole('button', { name: /create foia request/i }));

      await waitFor(() => {
        expect(mockCreateFOIARequest).toHaveBeenCalledWith(
          expect.objectContaining({ agencyName: 'Department of Defense' })
        );
      });
    });

    it('pre-fills solicitation number when provided', async () => {
      const user = userEvent.setup();
      render(
        <CreateFOIARequestDialog
          {...defaultProps}
          solicitationNumber="W911NF-21-R-0001"
        />
      );
      const input = screen.getByLabelText(/solicitation number/i) as HTMLInputElement;
      expect(input).toBeInTheDocument();
      // Fill remaining required fields and submit to verify the default value is used
      await user.type(screen.getByLabelText(/agency name/i), 'Department of Defense');
      await user.type(screen.getByLabelText(/^name \*/i), 'John Doe');
      await user.type(screen.getByLabelText(/^email \*/i), 'john@company.com');
      await user.click(screen.getByTestId('checkbox-SSEB_REPORT'));
      await user.click(screen.getByRole('button', { name: /create foia request/i }));

      await waitFor(() => {
        expect(mockCreateFOIARequest).toHaveBeenCalledWith(
          expect.objectContaining({ solicitationNumber: 'W911NF-21-R-0001' })
        );
      });
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

      // zodResolver prevents onSubmit from being called and shows field-level validation errors
      await waitFor(() => {
        expect(screen.getByText(/at least one document type is required/i)).toBeInTheDocument();
      });

      expect(mockCreateFOIARequest).not.toHaveBeenCalled();
    });

    it('calls createFOIARequest on successful submission', async () => {
      const user = userEvent.setup();
      render(<CreateFOIARequestDialog {...defaultProps} />);

      await fillAndSubmitForm(user);

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
      const user = userEvent.setup();
      render(<CreateFOIARequestDialog {...defaultProps} />);

      await fillAndSubmitForm(user);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'FOIA Request Created',
          })
        );
      });
    });

    it('calls onOpenChange(false) after successful submission', async () => {
      const user = userEvent.setup();
      const onOpenChange = jest.fn();
      render(<CreateFOIARequestDialog {...defaultProps} onOpenChange={onOpenChange} />);

      await fillAndSubmitForm(user);

      await waitFor(() => {
        expect(onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    it('calls onSuccess callback after successful submission', async () => {
      const user = userEvent.setup();
      const onSuccess = jest.fn();
      render(<CreateFOIARequestDialog {...defaultProps} onSuccess={onSuccess} />);

      await fillAndSubmitForm(user);

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
