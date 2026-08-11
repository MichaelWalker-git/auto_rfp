import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { FOIARequestCard } from '../FOIARequestCard';
import { useFOIARequests } from '@/lib/hooks/use-foia-requests';
import type { FOIARequestItem } from '@auto-rfp/core';

const mockGenerateFOIALetter = jest.fn().mockResolvedValue('Dear FOIA Officer...');

// Mock the hooks and components
jest.mock('@/lib/hooks/use-foia-requests', () => ({
  useFOIARequests: jest.fn(),
  useGenerateFOIALetter: () => ({
    generateFOIALetter: mockGenerateFOIALetter,
  }),
  useDeleteFOIARequest: () => ({
    deleteFOIARequest: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));
jest.mock('../CreateFOIARequestDialog', () => ({
  CreateFOIARequestDialog: ({ isOpen }: { isOpen: boolean }) => (
    isOpen ? <div data-testid="create-foia-dialog">Dialog Open</div> : null
  ),
}));
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  usePermission: () => true, // Mock the hook to always return true (has permission)
}));

const mockUseFOIARequests = useFOIARequests as jest.MockedFunction<typeof useFOIARequests>;

describe('FOIARequestCard', () => {
  const defaultProps = {
    projectId: 'proj-123',
    orgId: 'org-456',
    opportunityId: 'opp-789',
    projectOutcomeStatus: 'WON',
    agencyName: 'Test Agency',
    solicitationNumber: 'SOL-123',
    contractTitle: 'IT Services Support',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFOIARequests.mockReturnValue({
      foiaRequests: [],
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: jest.fn(),
    });
  });

  describe('visibility', () => {
    it('renders even when project outcome is not terminal', () => {
      render(<FOIARequestCard {...defaultProps} projectOutcomeStatus="SUBMITTED" />);
      expect(screen.getByText('FOIA Request')).toBeInTheDocument();
    });

    it('renders when project outcome is WON', () => {
      render(<FOIARequestCard {...defaultProps} projectOutcomeStatus="WON" />);
      expect(screen.getByText('FOIA Request')).toBeInTheDocument();
    });

    it('renders when project outcome is LOST', () => {
      render(<FOIARequestCard {...defaultProps} projectOutcomeStatus="LOST" />);
      expect(screen.getByText('FOIA Request')).toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('renders loading skeleton', () => {
      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [],
        isLoading: true,
        isError: false,
        error: undefined,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);
      expect(screen.getByText('FOIA Request')).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('renders empty state with messaging and button', () => {
      render(<FOIARequestCard {...defaultProps} />);

      expect(screen.getByText('No FOIA request yet')).toBeInTheDocument();
      expect(screen.getByText(/Submit a Freedom of Information Act request/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create FOIA Request' })).toBeInTheDocument();
    });

    it('opens dialog when Create FOIA Request button is clicked for WON outcome', () => {
      render(<FOIARequestCard {...defaultProps} projectOutcomeStatus="WON" />);

      const button = screen.getByRole('button', { name: 'Create FOIA Request' });
      fireEvent.click(button);

      expect(screen.getByTestId('create-foia-dialog')).toBeInTheDocument();
    });

    it('opens dialog when Create FOIA Request button is clicked for LOST outcome', () => {
      render(<FOIARequestCard {...defaultProps} projectOutcomeStatus="LOST" />);

      const button = screen.getByRole('button', { name: 'Create FOIA Request' });
      fireEvent.click(button);

      expect(screen.getByTestId('create-foia-dialog')).toBeInTheDocument();
    });

    it('shows warning dialog when Create FOIA Request button is clicked for SUBMITTED outcome', () => {
      render(<FOIARequestCard {...defaultProps} projectOutcomeStatus="SUBMITTED" />);

      const button = screen.getByRole('button', { name: 'Create FOIA Request' });
      fireEvent.click(button);

      expect(screen.queryByTestId('create-foia-dialog')).not.toBeInTheDocument();
      expect(screen.getByText('Mark the project outcome first')).toBeInTheDocument();
      expect(screen.getByText(/can only be created for projects with a/)).toBeInTheDocument();
      expect(screen.getByText('Won')).toBeInTheDocument();
      expect(screen.getByText('Lost')).toBeInTheDocument();
    });

    it('shows warning dialog for NO_BID outcome', () => {
      render(<FOIARequestCard {...defaultProps} projectOutcomeStatus="NO_BID" />);

      const button = screen.getByRole('button', { name: 'Create FOIA Request' });
      fireEvent.click(button);

      expect(screen.queryByTestId('create-foia-dialog')).not.toBeInTheDocument();
      expect(screen.getByText('Mark the project outcome first')).toBeInTheDocument();
    });

    it('shows warning dialog for WITHDRAWN outcome', () => {
      render(<FOIARequestCard {...defaultProps} projectOutcomeStatus="WITHDRAWN" />);

      const button = screen.getByRole('button', { name: 'Create FOIA Request' });
      fireEvent.click(button);

      expect(screen.queryByTestId('create-foia-dialog')).not.toBeInTheDocument();
      expect(screen.getByText('Mark the project outcome first')).toBeInTheDocument();
    });
  });

  describe('with FOIA request data', () => {
    it('renders FOIA request with agency info, documents, and Draft Letter button', () => {
      const foiaRequest: FOIARequestItem = {
        id: 'foia-123',
        foiaId: 'foia-123',
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        agencyName: 'Test Agency',
        agencyFOIAEmail: 'foia@agency.gov',
        agencyFOIAAddress: '123 Agency Blvd, Washington DC 20001',
        solicitationNumber: 'SOL-123',
        contractTitle: 'IT Services',
        requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL'],
        customDocumentRequests: [],
        feeLimit: 0,
        companyName: 'Acme Corp',
        awardDate: 'January 15, 2026',
        requesterName: 'John Doe',
        requesterTitle: 'Contracts Manager',
        requesterEmail: 'john@company.com',
        requesterPhone: '555-123-4567',
        requesterAddress: '123 Business Ave, Arlington VA 22201',
        requestedBy: 'user-789',
        createdAt: '2024-01-15T10:00:00+00:00',
        updatedAt: '2024-01-15T10:00:00+00:00',
        createdBy: 'user-789',
      };

      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [foiaRequest],
        isLoading: false,
        isError: false,
        error: undefined,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      expect(screen.getByText('FOIA Request')).toBeInTheDocument();
      expect(screen.getByText('Test Agency')).toBeInTheDocument();
      expect(screen.getByText('Requested Documents:')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Draft Letter/ })).toBeInTheDocument();
      expect(screen.getByText(/Created.*ago/)).toBeInTheDocument();
    });

  });

  describe('state jurisdiction labeling', () => {
    it('uses the state public records law in the title and empty state', () => {
      render(
        <FOIARequestCard {...defaultProps} jurisdiction="STATE" state="California" />,
      );

      expect(
        screen.getByText('Public Records Request — California Public Records Act (CPRA)'),
      ).toBeInTheDocument();
      expect(screen.getByText('No records request yet')).toBeInTheDocument();
      expect(
        screen.getByText(/Submit a request under the California Public Records Act \(CPRA\)/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Create Records Request' }),
      ).toBeInTheDocument();
    });

    it('uses FOIA labeling for federal jurisdiction', () => {
      render(<FOIARequestCard {...defaultProps} jurisdiction="FEDERAL" />);

      expect(screen.getByText('FOIA Request')).toBeInTheDocument();
      expect(screen.getByText('No FOIA request yet')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls generateFOIALetter when Draft Letter is clicked', () => {
      const foiaRequest: FOIARequestItem = {
        id: 'foia-123',
        foiaId: 'foia-123',
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        agencyName: 'Test Agency',
        agencyFOIAEmail: 'foia@agency.gov',
        agencyFOIAAddress: '123 Agency Blvd, Washington DC 20001',
        solicitationNumber: 'SOL-123',
        contractTitle: 'IT Services',
        requestedDocuments: ['SSEB_REPORT'],
        customDocumentRequests: [],
        feeLimit: 0,
        companyName: 'Acme Corp',
        awardDate: 'January 15, 2026',
        requesterName: 'John',
        requesterTitle: 'Contracts Manager',
        requesterEmail: 'john@test.com',
        requesterPhone: '555-123-4567',
        requesterAddress: '123 Business Ave, Arlington VA 22201',
        requestedBy: 'user-789',
        createdAt: '2024-01-15T10:00:00+00:00',
        updatedAt: '2024-01-15T10:00:00+00:00',
        createdBy: 'user-789',
      };

      mockUseFOIARequests.mockReturnValue({
        foiaRequests: [foiaRequest],
        isLoading: false,
        isError: false,
        error: undefined,
        refetch: jest.fn(),
      });

      render(<FOIARequestCard {...defaultProps} />);

      const draftButton = screen.getByRole('button', { name: /Draft Letter/ });
      fireEvent.click(draftButton);

      expect(mockGenerateFOIALetter).toHaveBeenCalledWith(
        'org-456',
        'proj-123',
        'opp-789',
        'foia-123'
      );
    });
  });
});
