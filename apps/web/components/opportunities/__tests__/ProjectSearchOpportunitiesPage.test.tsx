import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/env', () => ({ env: { BASE_API_URL: 'http://test-api.com' } }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/organizations/org-1/projects/proj-1/search-opportunities',
  useSearchParams: () => new URLSearchParams(),
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
jest.mock('@/lib/auth/auth-fetcher', () => ({ authFetcher: jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) }));

import ProjectSearchOpportunitiesPage from '../ProjectSearchOpportunitiesPage';

describe('canonical Search Opportunities page', () => {
  beforeEach(() => { jest.clearAllMocks(); hookResult = null; });

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
});
