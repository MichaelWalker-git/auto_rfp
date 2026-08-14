import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SearchOpportunity } from '@auto-rfp/core';

// ─── Mocks (hoisted above the component import) ───────────────────────────────

jest.mock('@/lib/env', () => ({
  env: { BASE_API_URL: 'http://test-api.com' },
}));

jest.mock('@/lib/auth/auth-fetcher', () => ({
  authFetcher: jest.fn(),
}));

// Pass-through, so tests can assert the exact options handed to the sanitizer.
// Also avoids loading the real dompurify, which `transformIgnorePatterns` does
// not cover and which no other test in this repo exercises.
jest.mock('dompurify', () => ({
  __esModule: true,
  default: { sanitize: jest.fn((html: string) => html) },
}));

import DOMPurify from 'dompurify';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { SearchOpportunityResultsTable } from '../SearchOpportunityResultsTable';

const mockAuthFetcher = authFetcher as jest.MockedFunction<typeof authFetcher>;
const mockSanitize = DOMPurify.sanitize as unknown as jest.Mock;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const makeOpportunity = (overrides: Partial<SearchOpportunity> = {}): SearchOpportunity => ({
  id: 'opp-1',
  source: 'SAM_GOV',
  solicitationNumber: 'SOL-1',
  noticeId: 'notice-1',
  title: 'Test Opportunity',
  type: 'SOLICITATION',
  postedDate: '2026-07-01',
  closingDate: '2026-12-31',
  naicsCode: '541512',
  organizationName: 'Test Agency',
  contractVehicle: null,
  setAside: null,
  technologyArea: null,
  description: null,
  descriptionUrl: null,
  active: true,
  baseAndAllOptionsValue: null,
  attachmentsCount: 0,
  url: null,
  ...overrides,
});

// `null` means "render without an orgId" — passing `undefined` would just fall
// back to the default parameter.
const renderTable = (opp: SearchOpportunity, orgId: string | null = 'org-1') =>
  render(
    <SearchOpportunityResultsTable
      opportunities={[opp]}
      isLoading={false}
      onImport={jest.fn()}
      importingId={null}
      orgId={orgId ?? undefined}
    />,
  );

const jsonResponse = (data: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => data,
  }) as unknown as Response;

/**
 * jsdom performs no layout, so scrollHeight/clientHeight are always 0 and the
 * component sees "no overflow". Stub them for the duration of one test to
 * exercise the overflow path. Restored automatically by `restoreAllMocks`.
 */
const withOverflow = (scrollHeight: number, clientHeight: number) => {
  jest.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
  jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
};

/**
 * `jest.setup.ts` installs an IntersectionObserver whose callback never fires,
 * which would make "nothing was fetched" assertions pass for the wrong reason.
 * This replaces it with one the test drives explicitly via `scrollIntoView()`.
 */
const observerCallbacks: IntersectionObserverCallback[] = [];

const installIntersectionObserver = () => {
  observerCallbacks.length = 0;
  class MockIntersectionObserver {
    constructor(cb: IntersectionObserverCallback) {
      observerCallbacks.push(cb);
    }
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
    takeRecords = jest.fn(() => []);
  }
  (global as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    MockIntersectionObserver;
};

/** Report every observed element as on screen. */
const scrollIntoView = async () => {
  await act(async () => {
    for (const cb of [...observerCallbacks]) {
      cb(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    }
  });
};

const SAM_DESCRIPTION_URL =
  'https://api.sam.gov/prod/opportunity/v1/noticedesc?noticeid=notice-1';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SearchOpportunityResultsTable — description disclosure', () => {
  beforeEach(() => {
    // clearAllMocks, not resetAllMocks — keeps the dompurify pass-through impl.
    jest.clearAllMocks();
    // clearAllMocks does NOT drain queued `...Once` values, so an unconsumed one
    // would leak into the next test. Reset this mock specifically.
    mockAuthFetcher.mockReset();
    installIntersectionObserver();
  });

  afterEach(() => {
    // Drop any scrollHeight/clientHeight spies so they don't leak between tests.
    jest.restoreAllMocks();
  });

  it('shows a HigherGov description immediately, with no toggle and no API call', () => {
    renderTable(
      makeOpportunity({
        source: 'HIGHER_GOV',
        id: 'hg-1',
        noticeId: null,
        solicitationNumber: null,
        description: 'AI summary paragraph.\n\nRaw description text.',
      }),
    );

    // No click — the text is on screen as soon as the results render.
    const panel = screen.getByTestId('description-text');
    expect(panel).toHaveTextContent('AI summary paragraph.');
    expect(panel).toHaveTextContent('Raw description text.');
    expect(screen.getByTestId('description-inline')).toContainElement(panel);
    expect(screen.queryByRole('button', { name: /description/i })).not.toBeInTheDocument();
    expect(mockAuthFetcher).not.toHaveBeenCalled();
    expect(screen.queryByText(/No description available/i)).not.toBeInTheDocument();
  });

  it('bounds a long inline description with its own scroll area', () => {
    renderTable(
      makeOpportunity({
        source: 'HIGHER_GOV',
        noticeId: null,
        description: 'x'.repeat(5000),
      }),
    );

    // Live summaries reach ~5,000 chars; the card must not grow without limit.
    const container = screen.getByTestId('description-inline');
    expect(container).toHaveClass('max-h-24');
    expect(container).toHaveClass('overflow-y-auto');
  });

  it('offers no expand control when the description fits', () => {
    // jsdom reports scrollHeight/clientHeight as 0, i.e. "no overflow".
    renderTable(
      makeOpportunity({ source: 'HIGHER_GOV', noticeId: null, description: 'Short summary.' }),
    );

    expect(screen.getByTestId('description-text')).toHaveTextContent('Short summary.');
    expect(screen.queryByRole('button', { name: /show more/i })).not.toBeInTheDocument();
  });

  it('expands an overflowing description to full height and back', async () => {
    const user = userEvent.setup();
    // jsdom does no layout, so overflow has to be simulated.
    withOverflow(200, 96);

    renderTable(
      makeOpportunity({
        source: 'HIGHER_GOV',
        noticeId: null,
        description: 'Long summary.\n\n'.repeat(50),
      }),
    );

    const container = screen.getByTestId('description-inline');
    expect(container).toHaveClass('max-h-24');

    const showMore = screen.getByRole('button', { name: /show more/i });
    expect(showMore).toHaveAttribute('aria-expanded', 'false');
    await user.click(showMore);

    // Expanded: the height cap and the scrollbar are both gone.
    expect(container).not.toHaveClass('max-h-24');
    expect(container).not.toHaveClass('overflow-y-auto');

    const showLess = screen.getByRole('button', { name: /show less/i });
    expect(showLess).toHaveAttribute('aria-expanded', 'true');

    // The control must survive expansion — while expanded the box reports no
    // overflow, so a naive re-measure would make it disappear mid-read.
    await user.click(showLess);
    expect(screen.getByRole('button', { name: /show more/i })).toBeInTheDocument();
    expect(screen.getByTestId('description-inline')).toHaveClass('max-h-24');
  });

  it('preserves paragraph breaks and bypasses the HTML sanitizer for plain text', () => {
    renderTable(
      makeOpportunity({
        source: 'HIGHER_GOV',
        noticeId: null,
        description: 'First paragraph.\n\nSecond paragraph.',
      }),
    );

    const panel = screen.getByTestId('description-text');
    // The newlines must survive into the DOM — CSS turns them into breaks.
    expect(panel.textContent).toContain('\n\n');
    expect(panel).toHaveClass('whitespace-pre-line');
    // Plain text goes through React's own escaping, never dangerouslySetInnerHTML.
    expect(mockSanitize).not.toHaveBeenCalled();
    expect(screen.queryByTestId('description-html')).not.toBeInTheDocument();
  });

  it('shows a DIBBS description immediately, with no toggle and no API call', () => {
    renderTable(
      makeOpportunity({
        source: 'DIBBS',
        id: 'SPE1C1-26-Q-0001',
        noticeId: null,
        solicitationNumber: 'SPE1C1-26-Q-0001',
        description: 'NSN 1234-00-567-8901\n\nQuantity: 10 EA',
      }),
    );

    const panel = screen.getByTestId('description-text');
    expect(panel).toHaveTextContent('NSN 1234-00-567-8901');
    expect(panel.textContent).toContain('\n\n');
    expect(screen.queryByRole('button', { name: /description/i })).not.toBeInTheDocument();
    expect(mockAuthFetcher).not.toHaveBeenCalled();
  });

  it('fetches the SAM.gov description when the card scrolls into view, not on mount', async () => {
    mockAuthFetcher.mockResolvedValueOnce(jsonResponse({ description: '<p>Fetched SAM body</p>' }));

    renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }));

    // Off screen: results pages render 25 cards, so nothing is requested yet.
    expect(mockAuthFetcher).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /description/i })).not.toBeInTheDocument();

    await scrollIntoView();

    await waitFor(() =>
      expect(screen.getByTestId('description-html')).toHaveTextContent('Fetched SAM body'),
    );
    expect(mockAuthFetcher).toHaveBeenCalledTimes(1);
    expect(mockAuthFetcher).toHaveBeenCalledWith(
      'http://test-api.com/search-opportunities/opportunity-description?orgId=org-1',
      { method: 'POST', body: JSON.stringify({ descriptionUrl: SAM_DESCRIPTION_URL }) },
    );
  });

  it('fetches a SAM.gov description only once, even if visibility fires repeatedly', async () => {
    mockAuthFetcher.mockResolvedValue(jsonResponse({ description: '<p>Body</p>' }));

    renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }));

    await scrollIntoView();
    await scrollIntoView();
    await scrollIntoView();

    await waitFor(() => expect(screen.getByTestId('description-html')).toBeInTheDocument());
    expect(mockAuthFetcher).toHaveBeenCalledTimes(1);
  });

  it('makes no request for SAM.gov when orgId is unavailable', async () => {
    renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }), null);

    await scrollIntoView();

    // DibbsResultsTable renders this table without an orgId.
    expect(mockAuthFetcher).not.toHaveBeenCalled();
    expect(screen.queryByTestId('description-loading')).not.toBeInTheDocument();
  });

  it('offers a retry when the SAM.gov description fetch fails, and recovers', async () => {
    const user = userEvent.setup();
    mockAuthFetcher
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
      .mockResolvedValueOnce(jsonResponse({ description: '<p>Second attempt worked</p>' }));

    renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }));
    await scrollIntoView();

    // A silent blank card is what this replaces.
    await waitFor(() => expect(screen.getByTestId('description-error')).toBeInTheDocument());
    expect(screen.getByText(/couldn't load description/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByTestId('description-html')).toHaveTextContent('Second attempt worked'),
    );
    expect(mockAuthFetcher).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('description-error')).not.toBeInTheDocument();
  });

  it('offers a retry when the fetch throws', async () => {
    mockAuthFetcher.mockRejectedValueOnce(new Error('network down'));

    renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }));
    await scrollIntoView();

    await waitFor(() => expect(screen.getByTestId('description-error')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('says so plainly when SAM.gov reports no description, with no retry', async () => {
    // 404/400 is definitive — retrying would return the same answer.
    mockAuthFetcher.mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);

    renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }));
    await scrollIntoView();

    await waitFor(() => expect(screen.getByTestId('description-empty')).toBeInTheDocument());
    expect(screen.getByText(/no description provided/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('claims nothing about a description before its fetch resolves', () => {
    // No mock queued on purpose: nothing should be requested while off screen.
    renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }));

    expect(mockAuthFetcher).not.toHaveBeenCalled();
    expect(screen.queryByTestId('description-empty')).not.toBeInTheDocument();
    expect(screen.queryByTestId('description-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('description-loading')).not.toBeInTheDocument();
  });

  it('sanitizes fetched SAM.gov HTML with an explicit allow-list', async () => {
    mockAuthFetcher.mockResolvedValueOnce(
      jsonResponse({ description: '<p>Body</p><script>alert(1)</script>' }),
    );

    renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }));
    await scrollIntoView();
    await waitFor(() => expect(mockSanitize).toHaveBeenCalled());

    const [, options] = mockSanitize.mock.calls[0];
    expect(options).toMatchObject({ FORCE_BODY: true });
    expect(options.ALLOWED_TAGS).toContain('p');
    expect(options.ALLOWED_TAGS).not.toContain('script');
    expect(options.ALLOWED_ATTR).not.toContain('onerror');
  });

  it('shows skeletons — not a spinner — while the SAM.gov description loads', async () => {
    let resolveFetch: (r: Response) => void = () => {};
    mockAuthFetcher.mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { container } = renderTable(makeOpportunity({ descriptionUrl: SAM_DESCRIPTION_URL }));
    await scrollIntoView();

    expect(screen.getByTestId('description-loading')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('.animate-spin')).toBeNull();

    await act(async () => {
      resolveFetch(jsonResponse({ description: '<p>Loaded</p>' }));
    });

    await waitFor(() =>
      expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0),
    );
    expect(screen.getByTestId('description-html')).toHaveTextContent('Loaded');
  });

  it('shows an inline SAM.gov description immediately when there is no description URL', () => {
    // The Cypress search-results stub is exactly this shape.
    renderTable(makeOpportunity({ description: 'Inline SAM synopsis.', descriptionUrl: null }));

    expect(screen.getByTestId('description-text')).toHaveTextContent('Inline SAM synopsis.');
    expect(screen.queryByRole('button', { name: /description/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/No description available/i)).not.toBeInTheDocument();
    expect(mockAuthFetcher).not.toHaveBeenCalled();
  });

  it('prefers the inline description over fetching when SAM.gov sends both', () => {
    renderTable(
      makeOpportunity({
        description: 'Inline SAM synopsis.',
        descriptionUrl: SAM_DESCRIPTION_URL,
      }),
    );

    // Text in hand beats a network round-trip.
    expect(screen.getByTestId('description-text')).toHaveTextContent('Inline SAM synopsis.');
    expect(screen.queryByRole('button', { name: /description/i })).not.toBeInTheDocument();
    expect(mockAuthFetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['HigherGov with no description', { source: 'HIGHER_GOV' as const, noticeId: null }],
    ['SAM.gov with an empty description', { description: '' }],
    ['SAM.gov with a whitespace-only description', { description: '   \n  ' }],
  ])('renders neither a toggle nor a summary for %s', (_label, overrides) => {
    renderTable(makeOpportunity({ descriptionUrl: null, ...overrides }));

    expect(screen.queryByRole('button', { name: /description/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('description-inline')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import/i })).toBeInTheDocument();
  });
});
