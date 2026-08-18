import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FoiaAutomationCard } from '../FoiaAutomationCard';
import {
  useFoiaAutomation,
  useUpdateFoiaAutomation,
  useConfirmFoiaRecipient,
} from '@/lib/hooks/use-foia-automation';
import { useFOIARequests } from '@/lib/hooks/use-foia-requests';
import { useSendFoiaRequest } from '@/lib/hooks/use-foia-artifacts';
import type { FoiaAutomationItem, FOIARequestItem } from '@auto-rfp/core';

// Mock all hooks
jest.mock('@/lib/hooks/use-foia-automation');
jest.mock('@/lib/hooks/use-foia-requests', () => ({
  useFOIARequests: jest.fn(),
  // FOIALetterPreview (revived by the send controls) destructures this, so the
  // bare auto-mock returning undefined would throw on render.
  useGenerateFOIALetter: () => ({ generateFOIALetter: jest.fn().mockResolvedValue('Letter body') }),
}));
jest.mock('@/lib/hooks/use-foia-artifacts', () => ({
  useSendFoiaRequest: jest.fn(),
  // FoiaDocumentsList renders inside the card and destructures this.
  useFoiaArtifacts: () => ({ getDownloadUrl: jest.fn().mockResolvedValue('https://signed') }),
  // FoiaCustomDocumentsEditor renders alongside the send controls on
  // AWAITING_APPROVAL and destructures this.
  useUpdateFoiaCustomDocuments: () => ({
    updateCustomDocuments: jest.fn().mockResolvedValue('Letter body'),
    isSaving: false,
  }),
}));
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));
jest.mock('@/components/permission-wrapper', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  usePermission: () => true,
}));

const mockUseFoiaAutomation = useFoiaAutomation as jest.MockedFunction<typeof useFoiaAutomation>;
const mockUseUpdateFoiaAutomation = useUpdateFoiaAutomation as jest.MockedFunction<
  typeof useUpdateFoiaAutomation
>;
const mockUseConfirmFoiaRecipient = useConfirmFoiaRecipient as jest.MockedFunction<
  typeof useConfirmFoiaRecipient
>;
const mockUseFOIARequests = useFOIARequests as jest.MockedFunction<typeof useFOIARequests>;
const mockUseSendFoiaRequest = useSendFoiaRequest as jest.MockedFunction<typeof useSendFoiaRequest>;

describe('FoiaAutomationCard - Send Controls', () => {
  const defaultProps = {
    orgId: 'org-123',
    projectId: 'proj-456',
    opportunityId: 'opp-789',
    opportunityStatus: 'WON',
  };

  const mockUpdateFoiaAutomation = jest.fn();
  const mockConfirmRecipient = jest.fn();
  const mockSendFoiaRequest = jest.fn();
  const mockRefetch = jest.fn();
  const mockRefetchRequests = jest.fn();

  const mockFoiaRequest: FOIARequestItem = {
    foiaId: 'foia-123',
    id: 'req-123',
    projectId: 'proj-456',
    orgId: 'org-123',
    opportunityId: 'opp-789',
    agencyName: 'Test Agency',
    agencyFOIAEmail: 'foia@test.gov',
    agencyFOIAAddress: '123 Main St, Washington DC 20001',
    solicitationNumber: 'SOL-2024-001',
    contractTitle: 'Test Contract',
    requestedDocuments: ['SSEB_REPORT'],
    customDocumentRequests: [],
    feeLimit: 0,
    companyName: 'Test Company',
    awardDate: '2024-01-15',
    requesterName: 'John Doe',
    requesterTitle: 'Manager',
    requesterEmail: 'john@test.com',
    requesterPhone: '555-1234',
    requesterAddress: '456 Oak St',
    requestedBy: 'user-123',
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-01-10T10:00:00Z',
    createdBy: 'user-123',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseUpdateFoiaAutomation.mockReturnValue({
      updateFoiaAutomation: mockUpdateFoiaAutomation,
      isSaving: false,
    });
    mockUseConfirmFoiaRecipient.mockReturnValue({
      confirmRecipient: mockConfirmRecipient,
      isSaving: false,
    });
    mockUseFOIARequests.mockReturnValue({
      foiaRequests: [mockFoiaRequest],
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetchRequests,
    });
    mockUseSendFoiaRequest.mockReturnValue({
      sendFoiaRequest: mockSendFoiaRequest,
      isSending: false,
    });
  });

  it('shows send controls for AWAITING_APPROVAL state', () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'AWAITING_APPROVAL',
      scheduledSendAt: '2024-02-01T10:00:00Z',
      foiaRequestId: 'foia-123',
      resolvedRecipientEmail: 'foia@test.gov',
      approvalRequestedAt: '2024-01-15T10:00:00Z',
      attemptCount: 0,
      createdAt: '2024-01-10T10:00:00Z',
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);

    expect(screen.getByText('Review letter')).toBeInTheDocument();
    expect(screen.getByText('Preview (dry run)')).toBeInTheDocument();
    expect(screen.getByText('Send request')).toBeInTheDocument();
  });

  it('shows send controls for STALLED state', () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'STALLED',
      scheduledSendAt: '2024-02-01T10:00:00Z',
      foiaRequestId: 'foia-123',
      resolvedRecipientEmail: 'foia@test.gov',
      stalledAt: '2024-01-20T10:00:00Z',
      attemptCount: 0,
      createdAt: '2024-01-10T10:00:00Z',
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);

    expect(screen.getByText('Review letter')).toBeInTheDocument();
    expect(screen.getByText('Send request')).toBeInTheDocument();
  });

  it('does not show send controls for SCHEDULED state', () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SCHEDULED',
      scheduledSendAt: '2024-02-01T10:00:00Z',
      attemptCount: 0,
      createdAt: '2024-01-10T10:00:00Z',
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);

    expect(screen.queryByText('Review letter')).not.toBeInTheDocument();
    expect(screen.queryByText('Send request')).not.toBeInTheDocument();
  });

  it('opens confirm dialog with recipient email when Send request clicked', async () => {
    const user = userEvent.setup();
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'AWAITING_APPROVAL',
      scheduledSendAt: '2024-02-01T10:00:00Z',
      foiaRequestId: 'foia-123',
      resolvedRecipientEmail: 'foia@test.gov',
      attemptCount: 0,
      createdAt: '2024-01-10T10:00:00Z',
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);

    const sendButton = screen.getByText('Send request');
    await user.click(sendButton);

    await waitFor(() => {
      expect(screen.getByText('Send FOIA request?')).toBeInTheDocument();
      expect(screen.getByText(/foia@test.gov/)).toBeInTheDocument();
      expect(
        screen.getByText(/This action cannot be undone. The request will be sent to a government agency./)
      ).toBeInTheDocument();
    });
  });

  it('calls sendFoiaRequest with dryRun when Preview clicked', async () => {
    const user = userEvent.setup();
    mockSendFoiaRequest.mockResolvedValue({
      ok: true,
      dryRun: true,
      recipient: 'foia@test.gov',
      subject: 'FOIA Request - SOL-2024-001',
      letter: 'Test letter content',
      attached: ['letter.pdf'],
    });

    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'AWAITING_APPROVAL',
      scheduledSendAt: '2024-02-01T10:00:00Z',
      foiaRequestId: 'foia-123',
      resolvedRecipientEmail: 'foia@test.gov',
      attemptCount: 0,
      createdAt: '2024-01-10T10:00:00Z',
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);

    const previewButton = screen.getByText('Preview (dry run)');
    await user.click(previewButton);

    await waitFor(() => {
      expect(mockSendFoiaRequest).toHaveBeenCalledWith({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        dryRun: true,
      });
    });
  });

  it('does not call real send when dry run is used', async () => {
    const user = userEvent.setup();
    mockSendFoiaRequest.mockResolvedValue({
      ok: true,
      dryRun: true,
      recipient: 'foia@test.gov',
      subject: 'FOIA Request',
      letter: 'Test',
      attached: [],
    });

    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'AWAITING_APPROVAL',
      foiaRequestId: 'foia-123',
      resolvedRecipientEmail: 'foia@test.gov',
      attemptCount: 0,
      createdAt: '2024-01-10T10:00:00Z',
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);

    const previewButton = screen.getByText('Preview (dry run)');
    await user.click(previewButton);

    await waitFor(() => {
      const calls = mockSendFoiaRequest.mock.calls;
      expect(calls.every((call) => call[0].dryRun === true)).toBe(true);
    });
  });

  it('shows BOUNCED state with reason and next steps', () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'BOUNCED',
      bounceReason: 'Mailbox full',
      sentAt: '2024-01-15T10:00:00Z',
      artifacts: [
        {
          kind: 'LETTER_PDF',
          s3Key: 'letter.pdf',
          fileName: 'letter.pdf',
          contentType: 'application/pdf',
          createdAt: '2024-01-15T10:00:00Z',
        },
      ],
      attemptCount: 0,
      createdAt: '2024-01-10T10:00:00Z',
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);

    expect(screen.getByText('Email bounced.')).toBeInTheDocument();
    expect(screen.getByText('Mailbox full')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Verify the recipient email address and resend, or file the request manually via the agency's portal./
      )
    ).toBeInTheDocument();
  });
});
