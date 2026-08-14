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
  searchHigherGovOpportunities: (...args: unknown[]) => mockSearchHigherGov(...args),
  withSourceTimeout: (...args: unknown[]) => mockWithSourceTimeout(...args),
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
jest.mock('@/constants/highergov', () => ({ HIGHERGOV_SECRET_PREFIX: 'hg', HIGHERGOV_BASE_URL: 'https://highergov.com' }));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './search';

const makeEvent = (body: object, orgId = 'org-1'): APIGatewayProxyEventV2 =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: { orgId },
    headers: {},
    pathParameters: {},
  }) as unknown as APIGatewayProxyEventV2;

describe('search handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetApiKey.mockResolvedValue('key-123');
    mockWithSourceTimeout.mockImplementation((promise: Promise<unknown>) => promise);
  });

  it('returns partial results when one source times out', async () => {
    mockSearchSam.mockResolvedValue({ totalRecords: 2, opportunities: [{ id: '1' }, { id: '2' }] });
    mockSearchDibbs.mockRejectedValue(new Error('DIBBS is responding slowly. Please try again later.'));
    mockSearchHigherGov.mockResolvedValue({ totalCount: 1, results: [{ id: '3' }] });

    mockWithSourceTimeout.mockImplementation((promise: Promise<unknown>) => promise);

    const result = await baseHandler(makeEvent({ source: 'ALL', keywords: 'test' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(body.errors).toEqual({ DIBBS: 'DIBBS is responding slowly. Please try again later.' });
    expect(body.opportunities.length).toBe(3);
    expect(body.totalSamGov).toBe(2);
    expect(body.totalDibbs).toBe(0);
    expect(body.totalHigherGov).toBe(1);
  });

  it('returns all errors when all sources fail', async () => {
    mockSearchSam.mockRejectedValue(new Error('SAM.gov is responding slowly. Please try again later.'));
    mockSearchDibbs.mockRejectedValue(new Error('DIBBS is responding slowly. Please try again later.'));
    mockSearchHigherGov.mockRejectedValue(new Error('HigherGov is responding slowly. Please try again later.'));

    const result = await baseHandler(makeEvent({ source: 'ALL', keywords: 'test' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(body.opportunities).toEqual([]);
    expect(body.total).toBe(0);
    expect(body.errors).toEqual({
      SAM_GOV: 'SAM.gov is responding slowly. Please try again later.',
      DIBBS: 'DIBBS is responding slowly. Please try again later.',
      HIGHER_GOV: 'HigherGov is responding slowly. Please try again later.',
    });
  });

  it('calls withSourceTimeout for each source', async () => {
    const samPromise = Promise.resolve({ totalRecords: 0, opportunities: [] });
    const dibbsPromise = Promise.resolve({ totalRecords: 0, opportunities: [] });
    const hgPromise = Promise.resolve({ totalCount: 0, results: [] });

    mockSearchSam.mockReturnValue(samPromise);
    mockSearchDibbs.mockReturnValue(dibbsPromise);
    mockSearchHigherGov.mockReturnValue(hgPromise);
    mockWithSourceTimeout.mockImplementation((p: Promise<unknown>) => p);

    await baseHandler(makeEvent({ source: 'ALL', keywords: 'infra' }));

    expect(mockWithSourceTimeout).toHaveBeenCalledTimes(3);
    expect(mockWithSourceTimeout).toHaveBeenCalledWith(expect.anything(), 'SAM.gov');
    expect(mockWithSourceTimeout).toHaveBeenCalledWith(expect.anything(), 'DIBBS');
    expect(mockWithSourceTimeout).toHaveBeenCalledWith(expect.anything(), 'HigherGov');
  });

  it('does not include errors field when all sources succeed', async () => {
    mockSearchSam.mockResolvedValue({ totalRecords: 1, opportunities: [{ id: '1' }] });
    mockSearchDibbs.mockResolvedValue({ totalRecords: 1, opportunities: [{ id: '2' }] });
    mockSearchHigherGov.mockResolvedValue({ totalCount: 1, results: [{ id: '3' }] });

    const result = await baseHandler(makeEvent({ source: 'ALL', keywords: 'test' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(body.errors).toBeUndefined();
    expect(body.opportunities.length).toBe(3);
  });

  it('forwards a search_id and drops the filters it already encodes', async () => {
    mockSearchHigherGov.mockResolvedValue({ totalCount: 0, results: [] });
    mockWithSourceTimeout.mockImplementation((p: Promise<unknown>) => p);

    await baseHandler(makeEvent({
      source: 'HIGHER_GOV',
      keywords: 'ignored when a search id is present',
      higherGovSearchId: 'BWr0PdG39B6mX8cG47AQ8',
    }));

    const [, params] = mockSearchHigherGov.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(params.searchId).toBe('BWr0PdG39B6mX8cG47AQ8');
    // The search_id already encodes its own keywords, filters and date range.
    expect(params.keywords).toBeUndefined();
    expect(params.sourceType).toBeUndefined();
    expect(params.postedDate).toBeUndefined();
  });

  it('keeps keyword filters when there is no search_id', async () => {
    mockSearchHigherGov.mockResolvedValue({ totalCount: 0, results: [] });
    mockWithSourceTimeout.mockImplementation((p: Promise<unknown>) => p);

    await baseHandler(makeEvent({ source: 'HIGHER_GOV', keywords: 'document processing' }));

    const [, params] = mockSearchHigherGov.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(params.pageSize).toBe(25);
    expect(params.keywords).toBe('document processing');
    expect(params.searchId).toBeUndefined();
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
