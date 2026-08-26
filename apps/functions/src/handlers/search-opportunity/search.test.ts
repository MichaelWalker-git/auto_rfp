jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
  Sentry: { addBreadcrumb: jest.fn() },
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

const mockGetApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: (...args: unknown[]) => mockGetApiKey(...args),
}));

const mockSearchSam = jest.fn();
const mockSearchDibbs = jest.fn();
const mockSearchHigherGov = jest.fn();
const mockWithSourceTimeout = jest.fn();

jest.mock('@/helpers/search-opportunity', () => ({
  searchSamOpportunities: (...args: unknown[]) => mockSearchSam(...args),
  searchDibbsOpportunities: (...args: unknown[]) => mockSearchDibbs(...args),
  withSourceTimeout: (...args: unknown[]) => mockWithSourceTimeout(...args),
  HIGHERGOV_TIMEOUT_MS: 22_000,
}));

// HigherGov keyword/NAICS search runs through their MCP server: the REST endpoint
// silently ignores those params, while MCP honours HigherGov's full query language.
jest.mock('@/helpers/highergov-mcp', () => ({
  searchHigherGovViaMcp: (...args: unknown[]) => mockSearchHigherGov(...args),
  // Real value, not a stand-in: the handler divides `offset` by this to derive a
  // page number, so a mocked-away constant would make the paging assertions vacuous.
  HIGHERGOV_MCP_PAGE_SIZE: 100,
}));

// HigherGov saved-search (search_id) requests now flow through an async cache +
// background worker rather than an inline API call, so both are mocked here.
const mockGetCache = jest.fn();
const mockIsStale = jest.fn();
const mockMarkPending = jest.fn();
jest.mock('@/helpers/highergov-search-cache', () => ({
  getHigherGovSearchCache: (...args: unknown[]) => mockGetCache(...args),
  isHigherGovSearchCacheStale: (...args: unknown[]) => mockIsStale(...args),
  markHigherGovSearchPending: (...args: unknown[]) => mockMarkPending(...args),
}));

const mockLambdaSend = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: jest.fn(() => ({ send: mockLambdaSend })),
  InvokeCommand: jest.fn((params) => ({ type: 'Invoke', params })),
}));

jest.mock('@auto-rfp/core', () => ({
  samSlimToSearchOpportunity: (o: unknown) => ({ ...(o as object), source: 'SAM_GOV' }),
  dibbsSlimToSearchOpportunity: (o: unknown) => ({ ...(o as object), source: 'DIBBS' }),
  higherGovToSearchOpportunity: (o: unknown) => ({ ...(o as object), source: 'HIGHER_GOV' }),
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: (_key: string, fallback: string) => fallback,
}));

jest.mock('@/constants/samgov', () => ({ SAM_GOV_SECRET_PREFIX: 'sam' }));
jest.mock('@/constants/dibbs', () => ({ DIBBS_SECRET_PREFIX: 'dibbs' }));
jest.mock('@/constants/highergov', () => ({
  HIGHERGOV_SECRET_PREFIX: 'hg',
  HIGHERGOV_BASE_URL: 'https://highergov.com',
  HIGHERGOV_SEARCH_WORKER_FUNCTION_NAME_ENV: 'HIGHERGOV_SEARCH_FUNCTION_NAME',
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './search';

const makeEvent = (body: object, orgId = 'org-1'): APIGatewayProxyEventV2 =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: { orgId },
    headers: {},
    pathParameters: {},
  }) as unknown as APIGatewayProxyEventV2;

/** A READY cache row so a search_id search returns HigherGov results inline. */
const readyCache = (opportunities: unknown[], totalCount: number) => ({
  status: 'READY',
  opportunities,
  totalCount,
  error: null,
});

describe('search handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetApiKey.mockResolvedValue('key-123');
    mockWithSourceTimeout.mockImplementation((promise: Promise<unknown>) => promise);
    // Default: no cache row, stale (→ triggers a worker + pending).
    mockGetCache.mockResolvedValue(null);
    mockIsStale.mockReturnValue(true);
    mockMarkPending.mockResolvedValue(undefined);
    mockLambdaSend.mockResolvedValue({});
    process.env.HIGHERGOV_SEARCH_FUNCTION_NAME = 'test-worker';
  });

  // The UI has always shown a two-ended "Closing date" range, but only the lower
  // bound reached SAM.gov (`rdlfrom`) — the upper half was parsed and then dropped,
  // so narrowing it changed nothing. SAM.gov does document an `rdlto`.
  it('forwards both ends of the closing-date range to SAM.gov', async () => {
    mockSearchSam.mockResolvedValue({ totalRecords: 0, opportunities: [] });

    await baseHandler(makeEvent({
      source: 'SAM_GOV',
      closingFrom: '09/01/2026',
      closingTo: '09/30/2026',
    }));

    expect(mockSearchSam).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rdlfrom: '09/01/2026', rdlto: '09/30/2026' }),
    );
  });

  // SAM.gov requires a posted range, and the fallback used to be the hardcoded
  // literals '01/01/2025'–'12/31/2025' — so a request without dates silently
  // excluded everything posted outside calendar 2025.
  it('defaults a missing posted range to a recent window, not a fixed year', async () => {
    mockSearchSam.mockResolvedValue({ totalRecords: 0, opportunities: [] });

    await baseHandler(makeEvent({ source: 'SAM_GOV', keywords: 'radar' }));

    const [, params] = mockSearchSam.mock.calls[0] as [unknown, { postedFrom: string; postedTo: string }];
    const thisYear = String(new Date().getFullYear());

    expect(params.postedFrom).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(params.postedTo).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(params.postedTo.endsWith(thisYear)).toBe(true);
    expect(params.postedFrom).not.toBe('01/01/2025');
    expect(params.postedTo).not.toBe('12/31/2025');
  });

  it('returns partial results when one source times out', async () => {
    mockSearchSam.mockResolvedValue({ totalRecords: 2, opportunities: [{ id: '1' }, { id: '2' }] });
    mockSearchDibbs.mockRejectedValue(new Error('DIBBS is responding slowly. Please try again later.'));
    // HigherGov is served from a READY cache row via its saved search_id.
    mockGetCache.mockResolvedValue(readyCache([{ id: '3', source: 'HIGHER_GOV' }], 1));
    mockIsStale.mockReturnValue(false);

    const result = await baseHandler(makeEvent({ source: 'ALL', keywords: 'test', higherGovSearchId: 'saved-1' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(body.errors).toEqual({ DIBBS: 'DIBBS is responding slowly. Please try again later.' });
    expect(body.opportunities.length).toBe(3);
    expect(body.totalSamGov).toBe(2);
    expect(body.totalDibbs).toBe(0);
    expect(body.totalHigherGov).toBe(1);
  });

  it('returns SAM/DIBBS errors and a pending flag when the HigherGov cache is cold', async () => {
    mockSearchSam.mockRejectedValue(new Error('SAM.gov is responding slowly. Please try again later.'));
    mockSearchDibbs.mockRejectedValue(new Error('DIBBS is responding slowly. Please try again later.'));
    // Cold cache → HigherGov goes async; no inline error, just pending.

    const result = await baseHandler(makeEvent({ source: 'ALL', keywords: 'test', higherGovSearchId: 'saved-1' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(body.opportunities).toEqual([]);
    expect(body.higherGovPending).toBe(true);
    expect(body.errors).toEqual({
      SAM_GOV: 'SAM.gov is responding slowly. Please try again later.',
      DIBBS: 'DIBBS is responding slowly. Please try again later.',
    });
  });

  it('calls withSourceTimeout for the inline sources (SAM, DIBBS, date-only HigherGov)', async () => {
    mockSearchSam.mockReturnValue(Promise.resolve({ totalRecords: 0, opportunities: [] }));
    mockSearchDibbs.mockReturnValue(Promise.resolve({ totalRecords: 0, opportunities: [] }));
    mockSearchHigherGov.mockReturnValue(Promise.resolve({ totalCount: 0, results: [] }));

    // No search_id + no keyword filters → HigherGov runs inline (date-only path).
    await baseHandler(makeEvent({ source: 'ALL', postedFrom: '01/01/2025' }));

    expect(mockWithSourceTimeout).toHaveBeenCalledTimes(3);
    expect(mockWithSourceTimeout).toHaveBeenCalledWith(expect.anything(), 'SAM.gov');
    expect(mockWithSourceTimeout).toHaveBeenCalledWith(expect.anything(), 'DIBBS');
    // HigherGov's inline path gets a longer timeout — its API responds in 12–15s.
    expect(mockWithSourceTimeout).toHaveBeenCalledWith(expect.anything(), 'HigherGov', 22_000);
  });

  it('does not include errors field when all sources succeed', async () => {
    mockSearchSam.mockResolvedValue({ totalRecords: 1, opportunities: [{ id: '1' }] });
    mockSearchDibbs.mockResolvedValue({ totalRecords: 1, opportunities: [{ id: '2' }] });
    mockGetCache.mockResolvedValue(readyCache([{ id: '3', source: 'HIGHER_GOV' }], 1));
    mockIsStale.mockReturnValue(false);

    const result = await baseHandler(makeEvent({ source: 'ALL', keywords: 'test', higherGovSearchId: 'saved-1' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(body.errors).toBeUndefined();
    expect(body.opportunities.length).toBe(3);
    expect(body.higherGovPending).toBeUndefined();
  });

  it('returns cached HigherGov results instantly without invoking the worker', async () => {
    mockGetCache.mockResolvedValue(readyCache([{ id: 'A', source: 'HIGHER_GOV' }, { id: 'B', source: 'HIGHER_GOV' }], 2));
    mockIsStale.mockReturnValue(false);

    const result = await baseHandler(makeEvent({ source: 'HIGHER_GOV', higherGovSearchId: 'saved-1' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(mockSearchHigherGov).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
    expect(mockMarkPending).not.toHaveBeenCalled();
    expect(body.totalHigherGov).toBe(2);
    expect(body.opportunities.length).toBe(2);
    expect(body.higherGovPending).toBeUndefined();
  });

  it('kicks off the worker and reports pending on a cold HigherGov cache', async () => {
    mockGetCache.mockResolvedValue(null);
    mockIsStale.mockReturnValue(true);

    const result = await baseHandler(makeEvent({ source: 'HIGHER_GOV', higherGovSearchId: 'saved-1' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(mockMarkPending).toHaveBeenCalledWith('org-1', 'saved-1', expect.any(String), expect.any(Number));
    expect(mockLambdaSend).toHaveBeenCalledTimes(1);
    const invokeArg = mockLambdaSend.mock.calls[0][0] as { params: { FunctionName: string; InvocationType: string; Payload: Buffer } };
    expect(invokeArg.params.FunctionName).toBe('test-worker');
    expect(invokeArg.params.InvocationType).toBe('Event');
    expect(JSON.parse(invokeArg.params.Payload.toString())).toEqual({ orgId: 'org-1', searchId: 'saved-1', pageSize: 25 });
    expect(body.higherGovPending).toBe(true);
    expect(body.opportunities).toEqual([]);
  });

  it('does not re-invoke the worker while a fresh PENDING row exists', async () => {
    mockGetCache.mockResolvedValue({ status: 'PENDING', opportunities: [], totalCount: 0, error: null });
    mockIsStale.mockReturnValue(false); // fresh pending — worker already running

    const result = await baseHandler(makeEvent({ source: 'HIGHER_GOV', higherGovSearchId: 'saved-1' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(mockMarkPending).not.toHaveBeenCalled();
    expect(mockLambdaSend).not.toHaveBeenCalled();
    expect(body.higherGovPending).toBe(true);
  });

  it('surfaces a HigherGov worker error from the cache row', async () => {
    mockGetCache.mockResolvedValue({ status: 'ERROR', opportunities: [], totalCount: 0, error: 'HigherGov API 500: boom' });
    mockIsStale.mockReturnValue(false);

    const result = await baseHandler(makeEvent({ source: 'HIGHER_GOV', higherGovSearchId: 'saved-1' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(mockLambdaSend).not.toHaveBeenCalled();
    expect(body.errors.HIGHER_GOV).toBe('HigherGov API 500: boom');
    expect(body.higherGovPending).toBeUndefined();
  });

  // A HigherGov keyword search used to be refused outright, because the REST endpoint
  // silently ignores `keywords`. It now runs against their MCP server, which supports it.
  it('runs a HigherGov keyword search instead of refusing it', async () => {
    mockSearchHigherGov.mockResolvedValue({ totalCount: 3, results: [], pages: 1 });

    const result = await baseHandler(makeEvent({ source: 'HIGHER_GOV', keywords: 'document processing' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(mockSearchHigherGov).toHaveBeenCalledTimes(1);
    expect(body.errors).toBeUndefined();
    expect(body.totalHigherGov).toBe(3);
  });

  it('forwards the query string verbatim, preserving HigherGov query operators', async () => {
    // Sanitising this would break their documented syntax: quoting alone is the
    // difference between 40 and 1593 results for "Document Management".
    mockSearchHigherGov.mockResolvedValue({ totalCount: 0, results: [], pages: 1 });
    const query = '("data dashboard" or "data center") -Subscription';

    await baseHandler(makeEvent({ source: 'HIGHER_GOV', keywords: query }));

    expect(mockSearchHigherGov).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ keyword: query }),
    );
  });

  it('forwards market and active-only to MCP', async () => {
    mockSearchHigherGov.mockResolvedValue({ totalCount: 0, results: [], pages: 1 });

    await baseHandler(makeEvent({
      source: 'HIGHER_GOV', keywords: 'saas',
      higherGovMarket: 'state_local', higherGovActiveOnly: true, naics: ['541511'],
    }));

    expect(mockSearchHigherGov).toHaveBeenCalledWith(
      expect.anything(),
      // MCP takes a single NAICS code, so only the first is sent.
      expect.objectContaining({ opportunityType: 'state_local', activeOnly: true, naicsCode: '541511' }),
    );
  });

  it('searches HigherGov alongside SAM in ALL mode', async () => {
    // Previously HigherGov was silently skipped here, contributing nothing.
    mockSearchSam.mockResolvedValue({ totalRecords: 1, opportunities: [{ id: '1' }] });
    mockSearchDibbs.mockResolvedValue({ totalRecords: 0, opportunities: [] });
    mockSearchHigherGov.mockResolvedValue({ totalCount: 2, results: [], pages: 1 });

    const result = await baseHandler(makeEvent({ source: 'ALL', keywords: 'document processing' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(mockSearchHigherGov).toHaveBeenCalledTimes(1);
    expect(body.errors).toBeUndefined();
    expect(body.totalHigherGov).toBe(2);
  });

  // MCP ignores `limit` and always returns 100 rows, and the frontend advances
  // `offset` by rows actually RECEIVED. Converting that offset with the caller's
  // 25-row limit jumped straight to page 5 on the first "show more", so records
  // 100-399 were never fetched and had no way to be reached.
  describe('MCP paging uses MCP\'s own page size, not the caller\'s limit', () => {
    beforeEach(() => {
      mockSearchHigherGov.mockResolvedValue({ totalCount: 631, results: [], pages: 7 });
    });

    const pageNumberFor = async (offset?: number, limit = 25): Promise<number | undefined> => {
      mockSearchHigherGov.mockClear();
      await baseHandler(makeEvent({ source: 'HIGHER_GOV', keywords: 'saas', limit, offset }));
      const [, params] = mockSearchHigherGov.mock.calls[0] as [unknown, { pageNumber?: number }];
      return params.pageNumber;
    };

    it('asks for page 1 on the initial search', async () => {
      expect(await pageNumberFor(undefined)).toBe(1);
    });

    it('asks for page 2 after one page of 100 has loaded', async () => {
      // The bug asked for page 5 here, skipping records 100-399.
      expect(await pageNumberFor(100)).toBe(2);
    });

    it('walks consecutive pages as more rows load', async () => {
      expect(await pageNumberFor(200)).toBe(3);
      expect(await pageNumberFor(300)).toBe(4);
    });

    it('ignores the caller\'s limit, which MCP does not honour', async () => {
      expect(await pageNumberFor(100, 100)).toBe(2);
      expect(await pageNumberFor(100, 10)).toBe(2);
    });
  });

  it('skips source when no API key is configured', async () => {
    mockGetApiKey.mockImplementation((_orgId: string, prefix: string) => {
      if (prefix === 'sam') return Promise.resolve(null);
      return Promise.resolve('key');
    });
    mockSearchDibbs.mockResolvedValue({ totalRecords: 1, opportunities: [{ id: '1' }] });
    mockSearchHigherGov.mockResolvedValue({ totalCount: 0, results: [] });

    const result = await baseHandler(makeEvent({ source: 'ALL', keywords: 'test' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(mockSearchSam).not.toHaveBeenCalled();
    expect(body.totalSamGov).toBe(0);
    expect(body.opportunities.length).toBe(1);
  });

  it('returns 400 when orgId is missing', async () => {
    const event = {
      body: JSON.stringify({ keywords: 'test' }),
      queryStringParameters: {},
      headers: {},
      pathParameters: {},
    } as unknown as APIGatewayProxyEventV2;

    const result = await baseHandler(event);
    const body = JSON.parse((result as { body: string }).body);

    expect((result as { statusCode: number }).statusCode).toBe(400);
    expect(body.message).toBe('orgId is required');
  });
});
