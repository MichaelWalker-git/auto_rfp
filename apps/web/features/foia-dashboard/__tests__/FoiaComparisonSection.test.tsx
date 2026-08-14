import { render, screen } from '@testing-library/react';
import { FoiaComparisonSection } from '../components/FoiaComparisonSection';
import { FoiaOutcomeDonut } from '../components/FoiaOutcomeDonut';
import { FoiaPricingChart } from '../components/FoiaPricingChart';
import { FoiaScoreComparison } from '../components/FoiaScoreComparison';
import { FoiaDocumentsSummary } from '../components/FoiaDocumentsSummary';
import { useFoiaDashboard } from '@/lib/hooks/use-foia-dashboard';
import { usePermission } from '@/components/permission-wrapper';
import type { FoiaDashboardResponse } from '@auto-rfp/core';

jest.mock('@/lib/hooks/use-foia-dashboard');
jest.mock('@/components/permission-wrapper', () => ({
  usePermission: jest.fn(),
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// recharts needs a real layout box; jsdom reports zero, so charts render nothing
// useful. Stub the responsive wrapper to a fixed size so children mount.
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 600, height: 300 }}>{children}</div>
    ),
  };
});

const mockUseFoiaDashboard = useFoiaDashboard as jest.MockedFunction<typeof useFoiaDashboard>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const dashboard = (over: Partial<FoiaDashboardResponse> = {}): FoiaDashboardResponse => ({
  orgId: 'org-1',
  counts: { WON: 2, LOST: 5, NOT_PRESENT: 1, CANCELLED: 3 },
  pricing: [
    {
      oppId: 'opp-1',
      projectId: 'proj-1',
      title: 'Student Prospect Digital Profile Solution',
      solicitationNumber: 'RFP 739',
      agencyName: 'TTUHSC',
      ourBidAmount: 250_000,
      winningBidAmount: 198_500,
      winningContractor: 'Acme Systems',
      outcomeDate: '2026-01-29T00:00:00.000Z',
      hasPricing: true,
    },
  ],
  pricingCoverage: { withPricing: 1, total: 4 },
  scores: [
    {
      oppId: 'opp-1',
      projectId: 'proj-1',
      title: 'Student Prospect Digital Profile Solution',
      agencyName: 'TTUHSC',
      ourScores: { technical: 72, price: 88, overall: 78 },
      outcomeDate: '2026-01-29T00:00:00.000Z',
    },
  ],
  documentCount: 6,
  sentCount: 4,
  responseOutcomeCounts: { RECORDS_RECEIVED: 3, NO_RECORDS_LOCATED: 1 },
  calculatedAt: '2026-08-13T21:00:00.000Z',
  ...over,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asHook = (data: unknown, isLoading = false) => ({ data, isLoading } as any);

describe('FoiaComparisonSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePermission.mockReturnValue(true);
    mockUseFoiaDashboard.mockReturnValue(asHook({ dashboard: dashboard() }));
  });

  it('renders the section heading', () => {
    render(<FoiaComparisonSection orgId="org-1" />);

    expect(screen.getByText('FOIA Comparison')).toBeInTheDocument();
  });

  it('renders all four cards', () => {
    render(<FoiaComparisonSection orgId="org-1" />);

    expect(screen.getByText('FOIA Outcomes')).toBeInTheDocument();
    expect(screen.getByText('Requests & Released Records')).toBeInTheDocument();
    expect(screen.getByText('Our Price vs Winning Price')).toBeInTheDocument();
    expect(screen.getByText('Evaluation Scores')).toBeInTheDocument();
  });

  it('states that it is not bound by the page date range', () => {
    // A response arrives months after the award, so a reader must not assume the
    // month filter above applies here.
    render(<FoiaComparisonSection orgId="org-1" />);

    expect(screen.getByText(/all time/i)).toBeInTheDocument();
  });

  it('passes the orgId to the hook', () => {
    render(<FoiaComparisonSection orgId="org-42" />);

    expect(mockUseFoiaDashboard).toHaveBeenCalledWith('org-42');
  });
});

describe('FoiaOutcomeDonut', () => {
  it('shows skeletons while loading, not a spinner', () => {
    const { container } = render(<FoiaOutcomeDonut counts={undefined} isLoading />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  it('renders every bucket with its count', () => {
    render(<FoiaOutcomeDonut counts={dashboard().counts} isLoading={false} />);

    expect(screen.getByText('Won')).toBeInTheDocument();
    expect(screen.getByText('Lost')).toBeInTheDocument();
    expect(screen.getByText('No records held')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });

  it('explains what "no records held" means', () => {
    // Otherwise it reads as a missing value rather than the agency's answer.
    render(<FoiaOutcomeDonut counts={dashboard().counts} isLoading={false} />);

    expect(screen.getByText(/agency reported it holds no records/i)).toBeInTheDocument();
  });

  it('shows an empty state when nothing is tracked', () => {
    render(
      <FoiaOutcomeDonut
        counts={{ WON: 0, LOST: 0, NOT_PRESENT: 0, CANCELLED: 0 }}
        isLoading={false}
      />,
    );

    expect(screen.getByText(/no completed solicitations yet/i)).toBeInTheDocument();
  });

  it('totals the buckets in the description', () => {
    render(<FoiaOutcomeDonut counts={dashboard().counts} isLoading={false} />);

    expect(screen.getByText(/11 tracked solicitations/i)).toBeInTheDocument();
  });
});

describe('FoiaPricingChart', () => {
  const props = {
    orgId: 'org-1',
    pricing: dashboard().pricing,
    coverage: dashboard().pricingCoverage,
    isLoading: false,
  };

  it('shows a skeleton while loading', () => {
    const { container } = render(<FoiaPricingChart {...props} isLoading />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });

  /**
   * The coverage line is the whole reason this chart is trustworthy: the amounts are
   * typed in by hand on the loss form, so the chart can show one bar while the org has
   * forty losses. Without this line a reader takes one as the whole picture.
   */
  it('names how many losses are missing pricing', () => {
    render(<FoiaPricingChart {...props} />);

    expect(screen.getByText(/showing 1 of 4 recorded loss/i)).toBeInTheDocument();
    expect(screen.getByText(/3 have no bid amounts recorded/i)).toBeInTheDocument();
  });

  it('confirms complete coverage rather than staying silent', () => {
    // The absence of a warning should itself be informative.
    render(<FoiaPricingChart {...props} coverage={{ withPricing: 1, total: 1 }} />);

    expect(screen.getByText(/all recorded losses have bid amounts/i)).toBeInTheDocument();
  });

  it('explains where the numbers come from when there are none', () => {
    render(<FoiaPricingChart {...props} pricing={[]} coverage={{ withPricing: 0, total: 0 }} />);

    expect(screen.getByText(/no pricing recorded yet/i)).toBeInTheDocument();
    expect(screen.getByText(/entered on an opportunity's loss form/i)).toBeInTheDocument();
  });

  it('links to the opportunities list so the gap can be filled', () => {
    render(<FoiaPricingChart {...props} />);

    expect(screen.getByRole('link', { name: /add them on the opportunity/i })).toHaveAttribute(
      'href',
      '/organizations/org-1/opportunities',
    );
  });
});

describe('FoiaScoreComparison', () => {
  it('renders each scored criterion', () => {
    render(<FoiaScoreComparison scores={dashboard().scores} isLoading={false} />);

    expect(screen.getByText('Technical')).toBeInTheDocument();
    expect(screen.getByText('Price')).toBeInTheDocument();
    expect(screen.getByText('Overall')).toBeInTheDocument();
    expect(screen.getByText('72')).toBeInTheDocument();
  });

  it('omits criteria that were not scored', () => {
    render(<FoiaScoreComparison scores={dashboard().scores} isLoading={false} />);

    // The fixture has no management score, so the row must not appear at all rather
    // than render as zero.
    expect(screen.queryByText('Management')).not.toBeInTheDocument();
  });

  it('says the winner scores are absent instead of implying a comparison', () => {
    render(<FoiaScoreComparison scores={dashboard().scores} isLoading={false} />);

    expect(screen.getByText(/winner's scores not on file/i)).toBeInTheDocument();
  });

  it('shows an empty state with no scores', () => {
    render(<FoiaScoreComparison scores={[]} isLoading={false} />);

    expect(screen.getByText(/no evaluation scores recorded yet/i)).toBeInTheDocument();
  });
});

describe('FoiaDocumentsSummary', () => {
  const props = { orgId: 'org-1', dashboard: dashboard(), isLoading: false };

  it('shows sent and released counts to any role', () => {
    mockUsePermission.mockReturnValue(false);
    render(<FoiaDocumentsSummary {...props} />);

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
  });

  it('breaks down what agencies replied', () => {
    mockUsePermission.mockReturnValue(true);
    render(<FoiaDocumentsSummary {...props} />);

    expect(screen.getByText('Records received')).toBeInTheDocument();
    expect(screen.getByText('No records held for us')).toBeInTheDocument();
  });

  /**
   * Released records routinely name a competitor's pricing and individual evaluators,
   * so the aggregate count is open but the documents are not.
   */
  it('offers document access to an admin', () => {
    mockUsePermission.mockReturnValue(true);
    render(<FoiaDocumentsSummary {...props} />);

    expect(screen.getByRole('link', { name: /browse opportunities/i })).toBeInTheDocument();
    expect(screen.queryByText(/limited to administrators/i)).not.toBeInTheDocument();
  });

  it('withholds document access without foia:documents:read', () => {
    mockUsePermission.mockReturnValue(false);
    render(<FoiaDocumentsSummary {...props} />);

    expect(screen.getByText(/limited to administrators/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /browse opportunities/i })).not.toBeInTheDocument();
  });

  it('checks the document permission, not the send permission', () => {
    // foia:send is held by EDITOR and answers a different question; using it here
    // would admit every editor to the released records.
    mockUsePermission.mockReturnValue(true);
    render(<FoiaDocumentsSummary {...props} />);

    expect(mockUsePermission).toHaveBeenCalledWith('foia:documents:read');
    expect(mockUsePermission).not.toHaveBeenCalledWith('foia:send');
  });

  it('shows a skeleton while loading', () => {
    const { container } = render(<FoiaDocumentsSummary {...props} isLoading />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
  });
});
