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

const renderForm = (initialValues: Partial<FormValues>, onSearch = jest.fn()) => {
  render(
    <SearchOpportunityForm
      orgId="org-1"
      projectId="proj-1"
      onSearch={onSearch}
      isLoading={false}
      initialValues={initialValues}
    />,
  );
  return onSearch;
};

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
    criteria: Record<string, unknown>;
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

  // DIBBS and the old "all sources" mode are no longer selectable: filters are now
  // provider-aware, which requires exactly one provider, and DIBBS is not a provider
  // this product can use. The form coerces anything else to SAM.gov so that stale
  // URLs and previously-saved searches still open on a usable provider.
  it.each([
    ['a stored DIBBS search', 'DIBBS'],
    ['a legacy "all sources" search', 'all'],
  ])('saves %s as SAM_GOV with autoImport disabled', async (_label, source) => {
    renderForm({ source: source as never });

    const body = await saveAndReadBody();

    expect(body.source).toBe('SAM_GOV');
    expect(body.autoImport).toBe(false);
  });
});

/**
 * The heart of the search/import UX fix. Filters used to be one flat set shown for
 * every provider, so most of what the user typed was silently dropped or, for
 * HigherGov, client-filtered against an arbitrary 100-row slice — which reads as
 * "search filtering is broken". Only filters the chosen provider can honour are now
 * rendered, and only those are sent.
 */
describe('SearchOpportunityForm — filters are provider-aware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetcher.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
  });

  const submit = async (onSearch: jest.Mock) => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(onSearch).toHaveBeenCalled());
    return onSearch.mock.calls[0][0] as Record<string, unknown>;
  };

  it('DIBBS is not offered as a provider', async () => {
    renderForm({ source: 'SAM_GOV' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /SAM\.gov/i }));

    expect(await screen.findByRole('menuitemradio', { name: /HigherGov/i })).toBeTruthy();
    expect(screen.queryByRole('menuitemradio', { name: /DIBBS/i })).toBeNull();
    expect(screen.queryByRole('menuitemradio', { name: /All Sources/i })).toBeNull();
  });

  it('shows NAICS, set-aside and closing-date filters for SAM.gov', () => {
    renderForm({ source: 'SAM_GOV' });

    expect(screen.getByRole('button', { name: /NAICS/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Set-aside/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Closing date/i })).toBeTruthy();
  });

  // Keyword and NAICS are real filters for HigherGov now that search goes through their
  // MCP server. Set-aside and closing date remain unsupported there.
  it('offers keyword, NAICS, market and active-only for HigherGov', () => {
    renderForm({ source: 'HIGHER_GOV' });

    expect(screen.getByPlaceholderText(/close match/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /NAICS/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /All sources/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Active only/i })).toBeTruthy();
  });

  it('still hides set-aside and closing date for HigherGov — MCP exposes neither', () => {
    renderForm({ source: 'HIGHER_GOV' });

    expect(screen.queryByRole('button', { name: /Set-aside/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Closing date/i })).toBeNull();
  });

  it('sends only SAM.gov-supported criteria when SAM.gov is selected', async () => {
    // `higherGovSearchId` is seeded but must not be forwarded — SAM.gov ignores it.
    const onSearch = renderForm({
      source: 'SAM_GOV',
      keywords: 'radar',
      naics: ['541512'],
      setAsideCode: 'SBA',
      higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8',
      higherGovSourceType: 'sbir',
    });

    const criteria = await submit(onSearch);

    expect(criteria.sources).toEqual(['SAM_GOV']);
    expect(criteria.keywords).toBe('radar');
    expect(criteria.naics).toEqual(['541512']);
    expect(criteria.setAsideCode).toBe('SBA');
    expect(criteria.higherGovSearchId).toBeUndefined();
    expect(criteria.higherGovSourceType).toBeUndefined();
  });

  it('sends keyword and NAICS for HigherGov, but not set-aside or closing dates', async () => {
    const onSearch = renderForm({
      source: 'HIGHER_GOV',
      keywords: 'radar',
      naics: ['541512'],
      setAsideCode: 'SBA',
      higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8',
    });

    const criteria = await submit(onSearch);

    expect(criteria.sources).toEqual(['HIGHER_GOV']);
    expect(criteria.keywords).toBe('radar');
    expect(criteria.naics).toEqual(['541512']);
    expect(criteria.higherGovSearchId).toBe('BWr0PdG39B6mX8cG47AQ8');
    expect(criteria.higherGovMarket).toBe('all');
    expect(criteria.higherGovActiveOnly).toBe(true);
    // MCP's search_opportunities exposes neither of these.
    expect(criteria.setAsideCode).toBeUndefined();
    expect(criteria.closingFrom).toBeUndefined();
    expect(criteria.closingTo).toBeUndefined();
    // posted_date is a single day, so there is no range upper bound.
    expect(criteria.postedTo).toBeUndefined();
  });

  // Regression: the form seeds postedFrom to "30 days ago" for SAM.gov's range, but
  // HigherGov's `posted_date` is a SINGLE DAY. Forwarding it asked HigherGov for
  // opportunities posted on exactly that one day and reliably returned 0 — measured live:
  // `keyword=saas` alone gives 310, the same plus posted_date=<30 days ago> gives 0.
  it('does not send SAM.gov\'s seeded date range as a HigherGov single-day filter', async () => {
    const onSearch = renderForm({
      source: 'HIGHER_GOV',
      keywords: 'saas',
      postedFrom: new Date(2026, 6, 26),
      postedTo: new Date(2026, 7, 25),
    });

    const criteria = await submit(onSearch);

    expect(criteria.keywords).toBe('saas');
    expect(criteria.postedFrom).toBeUndefined();
    expect(criteria.postedTo).toBeUndefined();
  });

  it('sends a posted date only when picked on the HigherGov single-day picker', async () => {
    const onSearch = renderForm({
      source: 'HIGHER_GOV',
      keywords: 'saas',
      higherGovPostedOn: new Date(2026, 7, 1),
    });

    const criteria = await submit(onSearch);

    expect(criteria.postedFrom).toBe('2026-08-01');
  });

  it('passes HigherGov query operators through verbatim', async () => {
    // Sanitising any of this would break their documented query language — quoting alone
    // is the difference between 40 and 1593 results for "Document Management".
    const query = '("data dashboard" or "data center") -Subscription';
    const onSearch = renderForm({ source: 'HIGHER_GOV', keywords: query });

    const criteria = await submit(onSearch);

    expect(criteria.keywords).toBe(query);
  });

  it('extracts a HigherGov search ID from a pasted URL', async () => {
    const user = userEvent.setup();
    const onSearch = renderForm({ source: 'HIGHER_GOV' });

    await user.type(
      screen.getByPlaceholderText(/paste a HigherGov Search ID/i),
      'https://www.highergov.com/contract-opportunity/?searchID=BWr0PdG39B6mX8cG47AQ8',
    );

    const criteria = await submit(onSearch);

    expect(criteria.higherGovSearchId).toBe('BWr0PdG39B6mX8cG47AQ8');
  });
});

describe('SearchOpportunityForm — restoring from a URL keeps the default date window', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetcher.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
  });

  it('does not let an absent URL date erase the 30-day default', async () => {
    // `paramsToFormValues` returns a key for every field, so `postedFrom: undefined`
    // used to overwrite the default — the chip then read as unfiltered while the
    // hook still applied a 30-day window underneath.
    const user = userEvent.setup();
    const onSearch = jest.fn();
    render(
      <SearchOpportunityForm
        orgId="org-1"
        projectId="proj-1"
        onSearch={onSearch}
        isLoading={false}
        initialValues={{ source: 'SAM_GOV', keywords: 'radar', postedFrom: undefined, postedTo: undefined }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await waitFor(() => expect(onSearch).toHaveBeenCalled());

    const criteria = onSearch.mock.calls[0][0] as { postedFrom?: string; postedTo?: string };
    expect(criteria.postedFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(criteria.postedTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/**
 * The market and active-only filters have to be PERSISTED, not just sent.
 *
 * Both are "omitted means default" params on MCP's side — an absent
 * `opportunity_type` means federal_contract and an absent `active_opportunity`
 * means all history. Leaving them out of the saved-search body meant a saved
 * "State & Local, active only" search reopened as federal-only, all-time.
 */
describe('SearchOpportunityForm — saved searches persist market and active-only', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetcher.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
  });

  it('writes a non-default market and active flag into the saved criteria', async () => {
    renderForm({
      source: 'HIGHER_GOV',
      higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8',
      higherGovMarket: 'state_local',
      higherGovActiveOnly: false,
    });

    const { criteria } = await saveAndReadBody();

    expect(criteria.higherGovMarket).toBe('state_local');
    expect(criteria.higherGovActiveOnly).toBe(false);
  });

  it('writes the defaults explicitly rather than omitting them', async () => {
    // 'all' and true must be on the wire: omitted, HigherGov would apply
    // federal_contract and return all history instead.
    renderForm({ source: 'HIGHER_GOV', higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8' });

    const { criteria } = await saveAndReadBody();

    expect(criteria.higherGovMarket).toBe('all');
    expect(criteria.higherGovActiveOnly).toBe(true);
  });
});

/**
 * Saving must never invent a date. HigherGov's posted-date filter is a single
 * specific day, so a fabricated one silently pins every future run — including
 * scheduled ones — to whatever fake day the save happened to compute. This used to
 * fall back to the literal '01/01/2025' for any unset date, which is guaranteed to
 * fire for HigherGov: its postedTo is never collected at all, and postedFrom is only
 * ever set when the user explicitly used the single-day picker.
 */
describe('SearchOpportunityForm — saving never invents a posted date', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetcher.mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response);
  });

  it('omits postedFrom/postedTo for a HigherGov search with no posted-on day picked', async () => {
    renderForm({ source: 'HIGHER_GOV', higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8' });

    const { criteria } = await saveAndReadBody();

    expect(criteria.postedFrom).toBeUndefined();
    expect(criteria.postedTo).toBeUndefined();
  });

  it('never writes the 01/01/2025 placeholder for any unset date', async () => {
    renderForm({ source: 'HIGHER_GOV', higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8' });

    const { criteria } = await saveAndReadBody();

    expect(criteria.postedFrom).not.toBe('01/01/2025');
    expect(criteria.postedTo).not.toBe('01/01/2025');
  });

  it('still saves the exact day picked on the HigherGov single-day picker', async () => {
    renderForm({
      source: 'HIGHER_GOV',
      higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8',
      higherGovPostedOn: new Date(2026, 6, 6), // Jul 6, 2026
    });

    const { criteria } = await saveAndReadBody();

    expect(criteria.postedFrom).toBe('07/06/2026');
  });
});
