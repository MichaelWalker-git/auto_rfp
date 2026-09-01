import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/env', () => ({ env: { BASE_API_URL: 'http://test-api.com' } }));
// Reassigned per test to simulate landing on a URL that already describes a search.
let mockSearchParams = new URLSearchParams();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/organizations/org-1/projects/proj-1/search-opportunities',
  useSearchParams: () => mockSearchParams,
}));
const mockToast = jest.fn();
jest.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock('@/lib/hooks/use-saved-search', () => ({ useListSavedSearches: () => ({ items: [], isLoading: false }) }));
jest.mock('@/lib/hooks/use-highergov-favorites', () => ({
  useHigherGovFavorites: () => ({ unimportedCount: 0, totalCount: 0, configured: false, isLoading: false, error: null, refresh: jest.fn() }),
  useImportHigherGovFavorites: () => ({ importFavorites: jest.fn(), isImporting: false }),
}));
jest.mock('@/components/organizations/SavedSearchList', () => ({ SavedSearchList: () => <div>saved list</div> }));

const mockSearch = jest.fn();
let hookResult: unknown = null;
jest.mock('@/lib/hooks/use-search-opportunities', () => ({
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  useSearchOpportunities: () => ({
    result: hookResult, isLoading: false, isLoadingMore: false, hasMore: false,
    search: mockSearch, loadMore: jest.fn(),
  }),
}));
const mockAuthFetcher = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
jest.mock('@/lib/auth/auth-fetcher', () => ({ authFetcher: (...a: unknown[]) => mockAuthFetcher(...a) }));

import ProjectSearchOpportunitiesPage from '../ProjectSearchOpportunitiesPage';

describe('canonical Search Opportunities page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hookResult = null;
    mockSearchParams = new URLSearchParams();
  });

  it('describes only the two usable providers — no DIBBS', () => {
    render(<ProjectSearchOpportunitiesPage orgId="org-1" projectId="proj-1" />);
    const body = document.body.textContent ?? '';
    expect(body).toContain('Search SAM.gov and HigherGov');
    expect(body).not.toContain('DIBBS');
  });

  it('has the Saved Searches tab that the project page previously lacked', () => {
    render(<ProjectSearchOpportunitiesPage orgId="org-1" projectId="proj-1" />);
    expect(screen.getByRole('tab', { name: /Saved Searches/i })).toBeTruthy();
  });

  it('offers the paste-URL fallback, worded as a fallback', () => {
    render(<ProjectSearchOpportunitiesPage orgId="org-1" projectId="proj-1" />);
    expect(screen.getByRole('button', { name: /Not on SAM\.gov or HigherGov/i })).toBeTruthy();
  });

  it('renders a HigherGov result badge (previously missing entirely)', async () => {
    hookResult = {
      opportunities: [], totalSamGov: 0, totalDibbs: 0, totalHigherGov: 42, total: 42,
      samGovError: null, dibbsError: null, higherGovError: null, higherGovPending: false,
    };
    render(<ProjectSearchOpportunitiesPage orgId="org-1" projectId="proj-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText(/HigherGov: 42/i)).toBeTruthy());
  });

  it('exposes the per-page selector the project page previously lacked', async () => {
    hookResult = {
      opportunities: [], totalSamGov: 1, totalDibbs: 0, totalHigherGov: 0, total: 1,
      samGovError: null, dibbsError: null, higherGovError: null, higherGovPending: false,
    };
    render(<ProjectSearchOpportunitiesPage orgId="org-1" projectId="proj-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByText(/Per page/i)).toBeTruthy());
  });

  /**
   * The confusion this guards against: HigherGov's own site reports 2,675 for the same
   * words this app shows 70 for, and the entire difference is the Active filter. Fetching
   * the second number would cost 100 records of a 10,000/month allowance per search, so
   * the filter is named in copy instead.
   */
  it('explains that a HigherGov count is limited to open opportunities', async () => {
    // Land on a URL that already selects HigherGov, so the auto-search runs that provider.
    mockSearchParams = new URLSearchParams({ source: 'HIGHER_GOV', q: 'saas' });
    hookResult = {
      opportunities: [], totalSamGov: 0, totalDibbs: 0, totalHigherGov: 70, total: 70,
      samGovError: null, dibbsError: null, higherGovError: null, higherGovPending: false,
    };
    render(<ProjectSearchOpportunitiesPage orgId="org-1" projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText(/open opportunities only/i)).toBeTruthy());
  });

  it('names the market on the HigherGov badge so a blended count is not opaque', async () => {
    mockSearchParams = new URLSearchParams({ source: 'HIGHER_GOV', q: 'saas', hgMarket: 'state_local' });
    hookResult = {
      opportunities: [], totalSamGov: 0, totalDibbs: 0, totalHigherGov: 70, total: 70,
      samGovError: null, dibbsError: null, higherGovError: null, higherGovPending: false,
    };
    const { container } = render(<ProjectSearchOpportunitiesPage orgId="org-1" projectId="proj-1" />);

    // The badge interpolates several nodes, so match on the rendered text as a whole.
    await waitFor(() => expect(container.textContent).toMatch(/HigherGov \(state & local\)/i));
  });
});

/**
 * Bulk import reports all three outcomes.
 *
 * A 409 duplicate is neither a thrown failure nor an import, so it needs its own
 * count. Treating it as a success meant a batch of already-imported rows finished
 * with nothing imported, nothing said, and the duplicate dialog holding only the
 * last row — so "force import" would have silently dropped the others.
 */
describe('bulk import — duplicates are not counted as imports', () => {
  const twoRows = [
    { id: 'opp-1', source: 'SAM_GOV', title: 'First', noticeId: 'n-1' },
    { id: 'opp-2', source: 'SAM_GOV', title: 'Second', noticeId: 'n-2' },
  ];

  /** Reply per import call, in order. Non-import calls (api-key) always succeed. */
  const respondTo = (replies: Array<'ok' | 'duplicate' | 'error'>) => {
    let i = 0;
    mockAuthFetcher.mockImplementation((url: string) => {
      if (!String(url).includes('import-solicitation')) {
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }
      const reply = replies[i++];
      if (reply === 'duplicate') {
        const body = { message: 'already imported', existing: { oppId: 'old', title: 'First' } };
        return Promise.resolve({
          status: 409, ok: false,
          json: async () => body, text: async () => JSON.stringify(body),
        });
      }
      if (reply === 'error') {
        return Promise.resolve({
          status: 500, ok: false,
          json: async () => ({}), text: async () => JSON.stringify({ message: 'boom' }),
        });
      }
      return Promise.resolve({
        status: 202, ok: true,
        json: async () => ({ imported: 1, opportunityId: 'new-opp' }),
      });
    });
  };

  const runBulk = async () => {
    hookResult = {
      opportunities: twoRows, totalSamGov: 2, totalDibbs: 0, totalHigherGov: 0, total: 2,
      samGovError: null, dibbsError: null, higherGovError: null, higherGovPending: false,
    };
    render(<ProjectSearchOpportunitiesPage orgId="org-1" projectId="proj-1" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(screen.getByLabelText(/Select all results/i)).toBeTruthy());
    await user.click(screen.getByLabelText(/Select all results/i));
    await user.click(screen.getByRole('button', { name: /Import 2 selected/i }));
    await waitFor(() => expect(mockToast).toHaveBeenCalled());
    return mockToast.mock.calls.at(-1)![0] as { title: string; description: string; variant?: string };
  };

  beforeEach(() => { jest.clearAllMocks(); hookResult = null; });

  it('says nothing was imported when every row is already in the project', async () => {
    respondTo(['duplicate', 'duplicate']);

    const t = await runBulk();

    // The bug: this batch used to emit no toast at all.
    expect(t.title).toMatch(/Nothing imported/i);
    expect(t.description).toMatch(/2 already in this project/i);
    expect(t.description).not.toMatch(/2 imported/);
    expect(t.variant).toBe('destructive');
  });

  it('counts imports and duplicates separately in a mixed batch', async () => {
    respondTo(['ok', 'duplicate']);

    const t = await runBulk();

    expect(t.title).toMatch(/Imported 1 of 2/i);
    expect(t.description).toMatch(/1 imported/);
    expect(t.description).toMatch(/1 already in this project/i);
  });

  it('still reports genuine failures alongside successes', async () => {
    respondTo(['ok', 'error']);

    const t = await runBulk();

    expect(t.description).toMatch(/1 imported/);
    expect(t.description).toMatch(/1 failed/i);
    expect(t.variant).toBe('destructive');
  });

  it('does not open the duplicate dialog mid-batch', async () => {
    // Prompting per row would leave only the last duplicate reachable, so bulk skips
    // the dialog entirely and reports a count instead.
    respondTo(['duplicate', 'duplicate']);

    await runBulk();

    expect(screen.queryByText(/already been imported/i)).toBeNull();
  });

  it('emits one summary toast, not one per row', async () => {
    respondTo(['ok', 'ok']);

    await runBulk();

    const importToasts = mockToast.mock.calls.filter(c =>
      /import/i.test(String((c[0] as { title?: string })?.title ?? '')));
    expect(importToasts).toHaveLength(1);
  });
});
