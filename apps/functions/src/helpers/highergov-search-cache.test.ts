/**
 * Tests for the async HigherGov saved-search cache helpers: SK building,
 * stale-PENDING detection, and the PENDING/READY/ERROR write paths.
 */
const mockGetItem = jest.fn();
const mockPutItem = jest.fn();

jest.mock('@/helpers/db', () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  putItem: (...a: unknown[]) => mockPutItem(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  buildHigherGovSearchCacheSk,
  getHigherGovSearchCache,
  isHigherGovSearchCacheStale,
  markHigherGovSearchPending,
  markHigherGovSearchReady,
  markHigherGovSearchError,
  type HigherGovSearchCacheDBItem,
} from './highergov-search-cache';
import {
  HIGHERGOV_SEARCH_CACHE_PK,
  HIGHERGOV_SEARCH_CACHE_TTL_SECONDS,
  HIGHERGOV_SEARCH_PENDING_STALE_MS,
} from '@/constants/highergov';

const makeCache = (over: Partial<HigherGovSearchCacheDBItem>): HigherGovSearchCacheDBItem =>
  ({
    orgId: 'org-1',
    searchId: 'saved-1',
    status: 'PENDING',
    opportunities: [],
    totalCount: 0,
    error: null,
    startedAt: null,
    completedAt: null,
    ttl: 0,
    ...over,
  }) as HigherGovSearchCacheDBItem;

beforeEach(() => {
  jest.clearAllMocks();
  mockPutItem.mockImplementation((_pk, _sk, item) => Promise.resolve(item));
});

describe('buildHigherGovSearchCacheSk', () => {
  it('joins orgId and searchId with #', () => {
    expect(buildHigherGovSearchCacheSk('org-1', 'saved-1')).toBe('org-1#saved-1');
  });
});

describe('getHigherGovSearchCache', () => {
  it('reads the row by PK + built SK', async () => {
    mockGetItem.mockResolvedValue(makeCache({ status: 'READY' }));
    const row = await getHigherGovSearchCache('org-1', 'saved-1');
    expect(mockGetItem).toHaveBeenCalledWith(HIGHERGOV_SEARCH_CACHE_PK, 'org-1#saved-1');
    expect(row?.status).toBe('READY');
  });

  it('returns null when no row exists', async () => {
    mockGetItem.mockResolvedValue(null);
    expect(await getHigherGovSearchCache('org-1', 'saved-1')).toBeNull();
  });
});

describe('isHigherGovSearchCacheStale', () => {
  const now = 1_000_000_000_000;

  it('treats a missing row as stale (must fetch)', () => {
    expect(isHigherGovSearchCacheStale(null, now)).toBe(true);
  });

  it('treats READY as fresh (usable inline)', () => {
    expect(isHigherGovSearchCacheStale(makeCache({ status: 'READY' }), now)).toBe(false);
  });

  it('treats ERROR as fresh (surface the error, do not refetch)', () => {
    expect(isHigherGovSearchCacheStale(makeCache({ status: 'ERROR' }), now)).toBe(false);
  });

  it('treats a recent PENDING as fresh (worker still running)', () => {
    const startedAt = new Date(now - 1_000).toISOString();
    expect(isHigherGovSearchCacheStale(makeCache({ status: 'PENDING', startedAt }), now)).toBe(false);
  });

  it('treats an old PENDING as stale (worker likely crashed)', () => {
    const startedAt = new Date(now - HIGHERGOV_SEARCH_PENDING_STALE_MS - 1_000).toISOString();
    expect(isHigherGovSearchCacheStale(makeCache({ status: 'PENDING', startedAt }), now)).toBe(true);
  });

  it('treats a PENDING with no startedAt as stale', () => {
    expect(isHigherGovSearchCacheStale(makeCache({ status: 'PENDING', startedAt: null }), now)).toBe(true);
  });
});

describe('markHigherGovSearchPending', () => {
  it('writes a PENDING row with a TTL derived from nowMs', async () => {
    const nowMs = 1_700_000_000_000;
    await markHigherGovSearchPending('org-1', 'saved-1', '2026-08-14T00:00:00.000Z', nowMs);
    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const [pk, sk, item] = mockPutItem.mock.calls[0];
    expect(pk).toBe(HIGHERGOV_SEARCH_CACHE_PK);
    expect(sk).toBe('org-1#saved-1');
    expect(item.status).toBe('PENDING');
    expect(item.startedAt).toBe('2026-08-14T00:00:00.000Z');
    expect(item.completedAt).toBeNull();
    expect(item.ttl).toBe(Math.floor(nowMs / 1000) + HIGHERGOV_SEARCH_CACHE_TTL_SECONDS);
  });
});

describe('markHigherGovSearchReady', () => {
  it('persists opportunities and totalCount as READY', async () => {
    const opps = [{ id: 'a', source: 'HIGHER_GOV' }] as never;
    await markHigherGovSearchReady('org-1', 'saved-1', opps, 42, '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:31.000Z', 1_700_000_000_000);
    const [, , item] = mockPutItem.mock.calls[0];
    expect(item.status).toBe('READY');
    expect(item.opportunities).toBe(opps);
    expect(item.totalCount).toBe(42);
    expect(item.error).toBeNull();
    expect(item.startedAt).toBe('2026-08-14T00:00:00.000Z');
    expect(item.completedAt).toBe('2026-08-14T00:00:31.000Z');
  });
});

describe('markHigherGovSearchError', () => {
  it('persists the error message as ERROR', async () => {
    await markHigherGovSearchError('org-1', 'saved-1', 'boom', '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:05.000Z', 1_700_000_000_000);
    const [, , item] = mockPutItem.mock.calls[0];
    expect(item.status).toBe('ERROR');
    expect(item.error).toBe('boom');
    expect(item.opportunities).toEqual([]);
    expect(item.totalCount).toBe(0);
  });
});
