import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FOIARequestCard } from '../FOIARequestCard';
import { useFOIARequests } from '@/lib/hooks/use-foia-requests';
import type { FOIARequestItem } from '@auto-rfp/core';

// Mock the hooks and components
jest.mock('@/lib/hooks/use-foia-requests', () => ({
  useFOIARequests: jest.fn(),
}));
jest.mock('../FOIAStatusBadge', () => ({
  FOIAStatusBadge: ({ status }: { status: string }) => (
    <div data-testid="foia-status-badge" data-status={status}>
      {status}
    </div>
  ),
}));
jest.mock('../CreateFOIARequestDialog', () => ({
  CreateFOIARequestDialog: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="create-foia-dialog">Dialog Open</div> : null
  ),
}));
jest.mock('../FOIALetterPreview', () => ({
  FOIALetterPreview: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="foia-letter-preview">Letter Preview</div> : null
  ),
}));
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockUseFOIARequests = useFOIARequests as jest.MockedFunction<typeof useFOIARequests>;

describe('FOIARequestCard', () => {
  const defaultProps = {
    projectId: 'proj-123',
    orgId: 'org-456',
    opportunityId: 'opp-789',
    projectOutcomeStatus: 'LOST',
    agencyName: 'Test Agency',
    solicitationNumber: 'SOL-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // Set default mock return value
    mockUseFOIARequests.mockReturnValue({
      foiaRequests: [],
      isLoading: false,
      refetch: jest.fn(),
    });
  });

  describe('visibility', () => {
    it('returns null when project outcome is not LOST', () => {
      const { container } = render(
        <FOIARequestCard {...defaultProps} projectOutcomeStatus="WON" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders when project outcome is LOST', () => {
      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [],
        isLoading: false,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('FOIA Requests')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('renders loading skeleton with consistent structure', () => {
      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [],
        isLoading: true,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      // Check header with icon
      expect(screen.getByText('FOIA Requests')).toBeInTheDocument();
      
      // Check skeleton loading state (should have 3 skeletons now)
      const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
      expect(skeletons).toHaveLength(3);
    });
  });

  describe('empty state', () => {
    it('renders empty state with consistent messaging and button', () => {
      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [],
        isLoading: false,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      // Check consistent empty state messaging
      expect(screen.getByText('No FOIA requests yet')).toBeInTheDocument();
      expect(screen.getByText(/Submit a Freedom of Information Act request/)).toBeInTheDocument();
      
      // Check consistent button styling
      const button = screen.getByRole('button', { name: 'Create FOIA Request' });
      expect(button).toHaveClass('border'); // The button has border class instead of outline
    });

    it('opens dialog when Create FOIA Request button is clicked', () => {
      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [],
        isLoading: false,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      const button = screen.getByRole('button', { name: 'Create FOIA Request' });
      fireEvent.click(button);

      expect(screen.getByTestId('create-foia-dialog')).toBeInTheDocument();
    });
  });

  describe('with FOIA request data', () => {
    it('renders FOIA request with consistent structure', () => {
      const foiaRequest: FOIARequestItem = {
        id: 'foia-123',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'SUBMITTED',
        agencyName: 'Test Agency',
        agencyFOIAEmail: 'foia@agency.gov',
        requestedDocuments: ['EVALUATION_CRITERIA', 'WINNING_PROPOSAL'],
        responseDeadline: '2024-02-01T00:00:00Z',
        trackingNumber: 'TRACK-123',
        responseNotes: 'Request submitted successfully',
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      } as FOIARequestItem;

      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [foiaRequest],
        isLoading: false,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      // Check header with icon and New Request button
      expect(screen.getByText('FOIA Requests')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /New Request/ })).toBeInTheDocument();

      // Check status badge
      const badge = screen.getByTestId('foia-status-badge');
      expect(badge).toHaveAttribute('data-status', 'SUBMITTED');

      // Check agency info
      expect(screen.getByText('Test Agency')).toBeInTheDocument();

      // Check tracking number
      expect(screen.getByText('Tracking: TRACK-123')).toBeInTheDocument();

      // Check requested documents
      expect(screen.getByText('Requested Documents:')).toBeInTheDocument();

      // Check response notes
      expect(screen.getByText('Response Notes:')).toBeInTheDocument();
      expect(screen.getByText('Request submitted successfully')).toBeInTheDocument();

      // Check action buttons
      expect(screen.getByRole('button', { name: 'View Letter' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Email Agency/ })).toBeInTheDocument();

      // Check creation date
      expect(screen.getByText(/Created.*ago/)).toBeInTheDocument();
    });

    it('shows deadline warning for overdue requests', () => {
      const overdueRequest: FOIARequestItem = {
        id: 'foia-123',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'SUBMITTED',
        agencyName: 'Test Agency',
        requestedDocuments: ['EVALUATION_CRITERIA'],
        responseDeadline: '2020-01-01T00:00:00Z', // Past date
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
      } as FOIARequestItem;

      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [overdueRequest],
        isLoading: false,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      // Check that deadline shows as overdue with warning styling
      const deadlineElement = screen.getByText(/Due: Jan 1, 2020/);
      expect(deadlineElement.closest('div')).toHaveClass('text-destructive');
    });

    it('handles multiple requests with expand/collapse', () => {
      const requests: FOIARequestItem[] = [
        {
          id: 'foia-1',
          status: 'SUBMITTED',
          agencyName: 'Agency 1',
          requestedDocuments: ['EVALUATION_CRITERIA'],
          createdAt: '2024-01-15T10:00:00Z',
        },
        {
          id: 'foia-2',
          status: 'COMPLETED',
          agencyName: 'Agency 2',
          requestedDocuments: ['WINNING_PROPOSAL'],
          createdAt: '2024-01-10T10:00:00Z',
        },
      ] as FOIARequestItem[];

      mockUseFOIARequests.mockReturnValue({
        foiaRequests: requests,
        isLoading: false,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      // Check expand button
      const expandButton = screen.getByRole('button', { name: /Show 1 more request/ });
      expect(expandButton).toBeInTheDocument();

      // Click to expand
      fireEvent.click(expandButton);

      // Check that additional request is shown
      expect(screen.getByText(/Hide 1 more request/)).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('opens letter preview when View Letter is clicked', () => {
      const foiaRequest: FOIARequestItem = {
        id: 'foia-123',
        status: 'SUBMITTED',
        agencyName: 'Test Agency',
        requestedDocuments: ['EVALUATION_CRITERIA'],
        createdAt: '2024-01-15T10:00:00Z',
      } as FOIARequestItem;

      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [foiaRequest],
        isLoading: false,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      const viewButton = screen.getByRole('button', { name: 'View Letter' });
      fireEvent.click(viewButton);

      expect(screen.getByTestId('foia-letter-preview')).toBeInTheDocument();
    });
  });
});