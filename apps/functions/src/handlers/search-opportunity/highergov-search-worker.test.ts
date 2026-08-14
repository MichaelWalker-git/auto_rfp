/**
 * Tests for the async HigherGov saved-search worker (runHigherGovSearchJob):
 * invalid job → SKIPPED, missing key → ERROR row, success → READY row,
 * fetch failure → ERROR row, and startedAt preservation from the PENDING row.
 */
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
}));

const mockGetApiKey = jest.fn();
jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: (...a: unknown[]) => mockGetApiKey(...a),
}));

const mockSearchHigherGov = jest.fn();
jest.mock('@/helpers/highergov', () => ({
  searchHigherGovOpportunities: (...a: unknown[]) => mockSearchHigherGov(...a),
}));

const mockGetCache = jest.fn();
const mockMarkReady = jest.fn();
const mockMarkError = jest.fn();
jest.mock('@/helpers/highergov-search-cache', () => ({
  getHigherGovSearchCache: (...a: unknown[]) => mockGetCache(...a),
  markHigherGovSearchReady: (...a: unknown[]) => mockMarkReady(...a),
  markHigherGovSearchError: (...a: unknown[]) => mockMarkError(...a),
}));

jest.mock('@/constants/highergov', () => ({
  HIGHERGOV_SECRET_PREFIX: 'hg',
  HIGHERGOV_BASE_URL: 'https://highergov.com',
}));

jest.mock('@auto-rfp/core', () => {
  const { z } = jest.requireActual('zod');
  return {
    higherGovToSearchOpportunity: (o: unknown) => ({ ...(o as object), source: 'HIGHER_GOV' }),
    HigherGovSearchJobSchema: z.object({
      orgId: z.string().min(1),
      searchId: z.string().min(1),
      pageSize: z.number().int().positive().max(100).default(25),
    }),
  };
});

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { runHigherGovSearchJob } from './highergov-search-worker';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetApiKey.mockResolvedValue('key-123');
  mockGetCache.mockResolvedValue({ startedAt: '2026-08-14T00:00:00.000Z' });
  mockMarkReady.mockResolvedValue(undefined);
  mockMarkError.mockResolvedValue(undefined);
});

describe('runHigherGovSearchJob', () => {
  it('skips an invalid job without touching the cache', async () => {
    const result = await runHigherGovSearchJob({ orgId: '', searchId: 'saved-1', pageSize: 25 });
    expect(result).toEqual({ status: 'SKIPPED', reason: 'invalid-job' });
    expect(mockGetCache).not.toHaveBeenCalled();
    expect(mockSearchHigherGov).not.toHaveBeenCalled();
  });

  it('writes an ERROR row when no API key is configured', async () => {
    mockGetApiKey.mockResolvedValue(null);
    const result = await runHigherGovSearchJob({ orgId: 'org-1', searchId: 'saved-1', pageSize: 25 });
    expect(result.status).toBe('ERROR');
    expect(mockSearchHigherGov).not.toHaveBeenCalled();
    expect(mockMarkError).toHaveBeenCalledWith(
      'org-1', 'saved-1', 'No HigherGov API key configured', '2026-08-14T00:00:00.000Z', expect.any(String), expect.any(Number),
    );
  });

  it('fetches the saved search and writes a READY row on success', async () => {
    mockSearchHigherGov.mockResolvedValue({ totalCount: 3, results: [{ id: 'a' }, { id: 'b' }] });
    const result = await runHigherGovSearchJob({ orgId: 'org-1', searchId: 'saved-1', pageSize: 50 });

    expect(mockSearchHigherGov).toHaveBeenCalledWith(
      { baseUrl: 'https://highergov.com', apiKey: 'key-123', httpsAgent: expect.anything() },
      { searchId: 'saved-1', ordering: '-captured_date', pageSize: 50, pageNumber: 1 },
    );
    expect(result).toEqual({ status: 'READY', count: 2 });
    const [orgId, searchId, opps, totalCount, startedAt] = mockMarkReady.mock.calls[0];
    expect(orgId).toBe('org-1');
    expect(searchId).toBe('saved-1');
    expect(opps).toEqual([{ id: 'a', source: 'HIGHER_GOV' }, { id: 'b', source: 'HIGHER_GOV' }]);
    expect(totalCount).toBe(3);
    expect(startedAt).toBe('2026-08-14T00:00:00.000Z'); // preserved from PENDING row
  });

  it('writes an ERROR row when the HigherGov fetch throws', async () => {
    mockSearchHigherGov.mockRejectedValue(new Error('HigherGov API 500'));
    const result = await runHigherGovSearchJob({ orgId: 'org-1', searchId: 'saved-1', pageSize: 25 });
    expect(result).toEqual({ status: 'ERROR', reason: 'HigherGov API 500' });
    expect(mockMarkError).toHaveBeenCalledWith(
      'org-1', 'saved-1', 'HigherGov API 500', '2026-08-14T00:00:00.000Z', expect.any(String), expect.any(Number),
    );
    expect(mockMarkReady).not.toHaveBeenCalled();
  });

  it('stamps a fresh startedAt when there is no prior PENDING row', async () => {
    mockGetCache.mockResolvedValue(null);
    mockSearchHigherGov.mockResolvedValue({ totalCount: 0, results: [] });
    await runHigherGovSearchJob({ orgId: 'org-1', searchId: 'saved-1', pageSize: 25 });
    const [, , , , startedAt] = mockMarkReady.mock.calls[0];
    expect(typeof startedAt).toBe('string');
    expect(Number.isNaN(Date.parse(startedAt))).toBe(false);
  });

  it('defaults pageSize to 25 when omitted', async () => {
    mockSearchHigherGov.mockResolvedValue({ totalCount: 0, results: [] });
    await runHigherGovSearchJob({ orgId: 'org-1', searchId: 'saved-1' } as never);
    expect(mockSearchHigherGov).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pageSize: 25 }),
    );
  });
});
