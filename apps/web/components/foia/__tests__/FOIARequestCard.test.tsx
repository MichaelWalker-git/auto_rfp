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
    it('returns null when project outcome is not LOST', () => {
      const { container } = render(
        <FOIARequestCard {...defaultProps} projectOutcomeStatus="WON" />
      );
      expect(container.firstChild).toBeNull();
    });

    it('renders when project outcome is LOST', () => {
      render(<FOIARequestCard {...defaultProps} />);
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

    it('opens dialog when Create FOIA Request button is clicked', () => {
      render(<FOIARequestCard {...defaultProps} />);

      const button = screen.getByRole('button', { name: 'Create FOIA Request' });
      fireEvent.click(button);

      expect(screen.getByTestId('create-foia-dialog')).toBeInTheDocument();
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
