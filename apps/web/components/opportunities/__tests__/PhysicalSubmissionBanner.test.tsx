import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OpportunityItem } from '@auto-rfp/core';
import { PhysicalSubmissionBanner } from '../PhysicalSubmissionBanner';

const mockUpdateOpportunity = jest.fn();
const mockToast = jest.fn();

jest.mock('@/lib/hooks/use-opportunities', () => ({
  useUpdateOpportunity: () => ({
    trigger: mockUpdateOpportunity,
    isMutating: false,
  }),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const baseOpportunity: OpportunityItem = {
  id: 'opp-1',
  oppId: 'opp-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  source: 'SAM_GOV',
  title: 'Widget procurement',
  type: null,
  postedDateIso: null,
  responseDeadlineIso: '2026-09-30T00:00:00.000Z',
  noticeId: null,
  solicitationNumber: 'RFP 42',
  naicsCode: null,
  pscCode: null,
  organizationName: 'Some Agency',
  setAside: null,
  description: null,
  baseAndAllOptionsValue: null,
  status: 'PURSUING',
  submissionMethod: 'PHYSICAL',
  submissionMailingAddress: {
    addressLine1: '123 Main St',
    locality: 'Springfield',
    administrativeArea: 'IL',
    postalCode: '62701',
  },
  submissionMethodRationale: 'Proposals must be mailed in triplicate to the address above.',
};

const mockRefetch = jest.fn();

const defaultProps = {
  orgId: 'org-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  refetch: mockRefetch,
};

const submittedPatch = () => mockUpdateOpportunity.mock.calls[0]![0].patch;

describe('PhysicalSubmissionBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateOpportunity.mockResolvedValue({});
  });

  it('renders the address, deadline, and rationale when all fields are present', () => {
    render(<PhysicalSubmissionBanner {...defaultProps} opportunity={baseOpportunity} />);

    const banner = screen.getByTestId('physical-submission-banner');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent('123 Main St, Springfield, IL 62701');
    expect(banner).toHaveTextContent('Proposals must be mailed in triplicate');
    // 5 business days before 2026-09-30 (Wed) → 2026-09-23 (Wed)
    expect(banner).toHaveTextContent('Sep 23, 2026');
  });

  it('renders gracefully when submissionMailingAddress is null', () => {
    render(
      <PhysicalSubmissionBanner
        {...defaultProps}
        opportunity={{ ...baseOpportunity, submissionMailingAddress: null }}
      />,
    );

    const banner = screen.getByTestId('physical-submission-banner');
    expect(banner).toBeInTheDocument();
    expect(screen.queryByTestId('physical-submission-address')).not.toBeInTheDocument();
  });

  it('hides the deadline when responseDeadlineIso is null', () => {
    render(
      <PhysicalSubmissionBanner
        {...defaultProps}
        opportunity={{ ...baseOpportunity, responseDeadlineIso: null }}
      />,
    );

    expect(screen.queryByTestId('physical-submission-deadline')).not.toBeInTheDocument();
  });

  it('calls the PATCH mutation with the correct payload when toggled off, then refetches', async () => {
    const user = userEvent.setup();
    render(<PhysicalSubmissionBanner {...defaultProps} opportunity={baseOpportunity} />);

    await user.click(screen.getByRole('switch'));

    expect(mockUpdateOpportunity).toHaveBeenCalledWith({
      projectId: 'proj-1',
      oppId: 'opp-1',
      patch: { submissionMethod: 'ELECTRONIC' },
    });
    expect(submittedPatch()).toEqual({ submissionMethod: 'ELECTRONIC' });
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows an error toast and does not refetch when the mutation fails', async () => {
    mockUpdateOpportunity.mockRejectedValue(new Error('Network error'));
    const user = userEvent.setup();
    render(<PhysicalSubmissionBanner {...defaultProps} opportunity={baseOpportunity} />);

    await user.click(screen.getByRole('switch'));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    expect(mockRefetch).not.toHaveBeenCalled();
  });

  it('is absent when submissionMethod is ELECTRONIC', () => {
    const { container } = render(
      <PhysicalSubmissionBanner
        {...defaultProps}
        opportunity={{ ...baseOpportunity, submissionMethod: 'ELECTRONIC' }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is absent when submissionMethod is null', () => {
    const { container } = render(
      <PhysicalSubmissionBanner
        {...defaultProps}
        opportunity={{ ...baseOpportunity, submissionMethod: null }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a skeleton while loading instead of the banner', () => {
    render(<PhysicalSubmissionBanner {...defaultProps} opportunity={null} isLoading />);

    expect(screen.queryByTestId('physical-submission-banner')).not.toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('physical-submission-banner-skeleton')).toBeInTheDocument();
  });
});
