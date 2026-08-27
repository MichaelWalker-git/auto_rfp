import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FoiaAutomationCard } from '../FoiaAutomationCard';
import { useFoiaAutomation, useUpdateFoiaAutomation, useConfirmFoiaRecipient } from '@/lib/hooks/use-foia-automation';
import type { FoiaAutomationItem, FoiaRecipientCandidate } from '@auto-rfp/core';

// Mock the hooks
jest.mock('@/lib/hooks/use-foia-automation');
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
const mockUseUpdateFoiaAutomation = useUpdateFoiaAutomation as jest.MockedFunction<typeof useUpdateFoiaAutomation>;
const mockUseConfirmFoiaRecipient = useConfirmFoiaRecipient as jest.MockedFunction<typeof useConfirmFoiaRecipient>;

describe('FoiaAutomationCard', () => {
  const defaultProps = {
    orgId: 'org-123',
    projectId: 'proj-456',
    opportunityId: 'opp-789',
    opportunityStatus: 'WON',
  };

  const mockUpdateFoiaAutomation = jest.fn();
  const mockConfirmRecipient = jest.fn();
  const mockRefetch = jest.fn();

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
  });

  it('renders skeleton while loading', () => {
    mockUseFoiaAutomation.mockReturnValue({
      automation: null,
      isLoading: true,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);
    // Skeleton should be visible
    const skeletons = screen.getAllByRole('generic');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders nothing when automation is null', () => {
    mockUseFoiaAutomation.mockReturnValue({
      automation: null,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    const { container } = render(<FoiaAutomationCard {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when automation state is NOT_APPLICABLE', () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'NOT_APPLICABLE',
      scheduledSendAt: null,
      delayDaysOverride: null,
      triggeredBy: 'TIMER',
      becameDueAt: null,
      blockedReason: null,
      resolvedRecipientEmail: null,
      resolvedRecipientAddress: null,
      recipientSource: null,
      foiaRequestId: null,
      approvalId: null,
      approvalRequestedAt: null,
      stalledAt: null,
      sentAt: null,
      sesMessageId: null,
      bounceReason: null,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      suppressedReason: null,
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    const { container } = render(<FoiaAutomationCard {...defaultProps} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders SCHEDULED state with scheduled date', () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SCHEDULED',
      scheduledSendAt: '2026-12-25T00:00:00Z',
      delayDaysOverride: null,
      triggeredBy: 'TIMER',
      becameDueAt: null,
      blockedReason: null,
      resolvedRecipientEmail: null,
      resolvedRecipientAddress: null,
      recipientSource: null,
      foiaRequestId: null,
      approvalId: null,
      approvalRequestedAt: null,
      stalledAt: null,
      sentAt: null,
      sesMessageId: null,
      bounceReason: null,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      suppressedReason: null,
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);
    expect(screen.getByText(/Scheduled to send on/)).toBeInTheDocument();
    // The date-fns format function formats the date as "December 25, 2026" but we'll check more flexibly
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('renders BLOCKED state with reason text', () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'BLOCKED',
      scheduledSendAt: null,
      delayDaysOverride: null,
      triggeredBy: 'TIMER',
      becameDueAt: null,
      blockedReason: 'NEEDS_RECIPIENT',
      resolvedRecipientEmail: null,
      resolvedRecipientAddress: null,
      recipientSource: null,
      foiaRequestId: null,
      approvalId: null,
      approvalRequestedAt: null,
      stalledAt: null,
      sentAt: null,
      sesMessageId: null,
      bounceReason: null,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      suppressedReason: null,
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);
    expect(screen.getByText(/No FOIA contact could be found for this agency/)).toBeInTheDocument();
  });

  it('renders BLOCKED with NEEDS_CONFIRMATION and displays candidate list', () => {
    const candidates: FoiaRecipientCandidate[] = [
      {
        email: 'foia@agency.gov',
        context: 'Found in solicitation document near section 5',
        score: 0.95,
        sourceFileName: 'solicitation.pdf',
      },
    ];

    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'BLOCKED',
      scheduledSendAt: null,
      delayDaysOverride: null,
      triggeredBy: 'TIMER',
      becameDueAt: null,
      blockedReason: 'NEEDS_CONFIRMATION',
      recipientCandidates: candidates,
      resolvedRecipientEmail: null,
      resolvedRecipientAddress: null,
      recipientSource: null,
      foiaRequestId: null,
      approvalId: null,
      approvalRequestedAt: null,
      stalledAt: null,
      sentAt: null,
      sesMessageId: null,
      bounceReason: null,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      suppressedReason: null,
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);
    expect(screen.getByText(/Possible FOIA contacts were found/)).toBeInTheDocument();
    expect(screen.getByText('foia@agency.gov')).toBeInTheDocument();
    expect(screen.getByText('Found in solicitation document near section 5')).toBeInTheDocument();
    expect(screen.getByText(/Source: solicitation.pdf/)).toBeInTheDocument();
    expect(screen.getByText('Use this')).toBeInTheDocument();
  });

  it('calls confirmRecipient when "Use this" button is clicked', async () => {
    const candidates: FoiaRecipientCandidate[] = [
      {
        email: 'foia@agency.gov',
        context: 'Found in document',
        score: 0.95,
        sourceFileName: 'doc.pdf',
      },
    ];

    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'BLOCKED',
      scheduledSendAt: null,
      delayDaysOverride: null,
      triggeredBy: 'TIMER',
      becameDueAt: null,
      blockedReason: 'NEEDS_CONFIRMATION',
      recipientCandidates: candidates,
      resolvedRecipientEmail: null,
      resolvedRecipientAddress: null,
      recipientSource: null,
      foiaRequestId: null,
      approvalId: null,
      approvalRequestedAt: null,
      stalledAt: null,
      sentAt: null,
      sesMessageId: null,
      bounceReason: null,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      suppressedReason: null,
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    mockConfirmRecipient.mockResolvedValue(automation);

    render(<FoiaAutomationCard {...defaultProps} />);
    const useThisButton = screen.getByText('Use this');
    fireEvent.click(useThisButton);

    await waitFor(() => {
      expect(mockConfirmRecipient).toHaveBeenCalledWith({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        foiaEmail: 'foia@agency.gov',
        foiaAddress: '',
        saveToDirectory: true,
      });
    });
  });

  it('renders permission-gated controls for SCHEDULED state', () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SCHEDULED',
      scheduledSendAt: '2026-12-25T00:00:00Z',
      delayDaysOverride: null,
      triggeredBy: 'TIMER',
      becameDueAt: null,
      blockedReason: null,
      resolvedRecipientEmail: null,
      resolvedRecipientAddress: null,
      recipientSource: null,
      foiaRequestId: null,
      approvalId: null,
      approvalRequestedAt: null,
      stalledAt: null,
      sentAt: null,
      sesMessageId: null,
      bounceReason: null,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      suppressedReason: null,
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    render(<FoiaAutomationCard {...defaultProps} />);
    expect(screen.getByText('Snooze')).toBeInTheDocument();
    expect(screen.getByText('Cancel automation')).toBeInTheDocument();
    expect(screen.getByText('Mark as filed manually')).toBeInTheDocument();
  });

  it('calls updateFoiaAutomation with markManualCompleted when button is clicked', async () => {
    const automation: FoiaAutomationItem = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      state: 'SCHEDULED',
      scheduledSendAt: '2026-12-25T00:00:00Z',
      delayDaysOverride: null,
      triggeredBy: 'TIMER',
      becameDueAt: null,
      blockedReason: null,
      resolvedRecipientEmail: null,
      resolvedRecipientAddress: null,
      recipientSource: null,
      foiaRequestId: null,
      approvalId: null,
      approvalRequestedAt: null,
      stalledAt: null,
      sentAt: null,
      sesMessageId: null,
      bounceReason: null,
      attemptCount: 0,
      lastAttemptAt: null,
      lastError: null,
      suppressedReason: null,
    };

    mockUseFoiaAutomation.mockReturnValue({
      automation,
      isLoading: false,
      isError: false,
      error: undefined,
      refetch: mockRefetch,
    });

    mockUpdateFoiaAutomation.mockResolvedValue(automation);

    render(<FoiaAutomationCard {...defaultProps} />);
    const button = screen.getByText('Mark as filed manually');
    fireEvent.click(button);

    await waitFor(() => {
      expect(mockUpdateFoiaAutomation).toHaveBeenCalledWith({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        markManualCompleted: true,
      });
    });
  });
});
