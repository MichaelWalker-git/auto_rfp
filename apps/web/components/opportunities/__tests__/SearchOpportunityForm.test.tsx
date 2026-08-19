import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mocks (hoisted above the component import) ───────────────────────────────

jest.mock('@/lib/env', () => ({
  env: { BASE_API_URL: 'http://test-api.com' },
}));

jest.mock('@/lib/auth/auth-fetcher', () => ({
  authFetcher: jest.fn(),
}));

// RecentSearches (rendered inside the form) calls this on mount.
jest.mock('@/lib/hooks/use-saved-search', () => ({
  useListSavedSearches: () => ({ items: [], isLoading: false }),
}));

jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

import { authFetcher } from '@/lib/auth/auth-fetcher';
import { SearchOpportunityForm } from '../SearchOpportunityForm';
import type { FormValues } from '../SearchOpportunityForm';

const mockAuthFetcher = authFetcher as jest.MockedFunction<typeof authFetcher>;

const renderForm = (initialValues: Partial<FormValues>) =>
  render(
    <SearchOpportunityForm
      orgId="org-1"
      projectId="proj-1"
      onSearch={jest.fn()}
      isLoading={false}
      initialValues={initialValues}
    />,
  );

/** Open the save dialog and click "Save search", returning the POST body sent. */
const saveAndReadBody = async () => {
  const user = userEvent.setup();
  // The BookmarkPlus trigger button is titled "Save search".
  await user.click(screen.getByRole('button', { name: /save search/i }));
  // Dialog footer button (also "Save search") — the last matching button.
  const buttons = await screen.findAllByRole('button', { name: /save search/i });
  await user.click(buttons[buttons.length - 1]!);

  await waitFor(() => expect(mockAuthFetcher).toHaveBeenCalled());
  const [, opts] = mockAuthFetcher.mock.calls[0];
  return JSON.parse((opts as { body: string }).body) as {
    source: string;
    autoImport: boolean;
    projectId?: string;
    frequency: string;
  };
};

describe('SearchOpportunityForm — daily auto-import is scoped to HigherGov', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetcher.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
  });

  it('saves a HigherGov search with autoImport enabled', async () => {
    renderForm({ source: 'HIGHER_GOV', higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8' });

    const body = await saveAndReadBody();

    expect(body.source).toBe('HIGHER_GOV');
    expect(body.autoImport).toBe(true);
    expect(body.frequency).toBe('DAILY');
    expect(body.projectId).toBe('proj-1');
  });

  it('saves a SAM.gov search with autoImport disabled', async () => {
    renderForm({ source: 'SAM_GOV' });

    const body = await saveAndReadBody();

    expect(body.source).toBe('SAM_GOV');
    expect(body.autoImport).toBe(false);
  });

  it('saves a DIBBS search with autoImport disabled', async () => {
    renderForm({ source: 'DIBBS' });

    const body = await saveAndReadBody();

    expect(body.source).toBe('DIBBS');
    expect(body.autoImport).toBe(false);
  });

  it('saves an "all sources" search as SAM_GOV with autoImport disabled', async () => {
    renderForm({ source: 'all' });

    const body = await saveAndReadBody();

    expect(body.source).toBe('SAM_GOV');
    expect(body.autoImport).toBe(false);
  });
});
