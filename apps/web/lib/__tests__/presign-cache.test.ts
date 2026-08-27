/**
 * Tests for the presign cache.
 *
 * The first test is the whole reason this module exists: a header and a footer
 * logo resolving at the same moment used to cancel each other, because they shared
 * one `useSWRMutation` keyed on a single URL. Whichever lost rendered as a broken
 * image. Deduping to one in-flight promise per key makes that impossible.
 */

const mockPresignDownloadUrl = jest.fn();

jest.mock('@/lib/hooks/use-presign', () => ({
  presignDownloadUrl: (key: string) => mockPresignDownloadUrl(key),
  PRESIGN_TTL_SECONDS: 900,
}));

import {
  getPresignedDownloadUrl,
  __resetPresignCache,
  __setPresignClock,
} from '../presign-cache';

beforeEach(() => {
  jest.clearAllMocks();
  __resetPresignCache();
});

describe('getPresignedDownloadUrl — concurrency', () => {
  it('issues ONE request when two callers ask for the same key at once', async () => {
    let release: (url: string) => void = () => {};
    mockPresignDownloadUrl.mockReturnValue(new Promise<string>((res) => { release = res; }));

    // Header and footer resolving simultaneously — the exact scenario that broke.
    const a = getPresignedDownloadUrl('org/logo.png');
    const b = getPresignedDownloadUrl('org/logo.png');
    release('https://signed.example/logo.png');

    await expect(a).resolves.toBe('https://signed.example/logo.png');
    await expect(b).resolves.toBe('https://signed.example/logo.png');
    // Both callers succeed, and neither cancelled the other.
    expect(mockPresignDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it('resolves every caller when many request the same key', async () => {
    mockPresignDownloadUrl.mockResolvedValue('https://signed.example/a.png');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => getPresignedDownloadUrl('a.png')),
    );
    expect(results.every((r) => r === 'https://signed.example/a.png')).toBe(true);
    expect(mockPresignDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it('fetches distinct keys independently', async () => {
    mockPresignDownloadUrl.mockImplementation((k: string) => Promise.resolve(`https://x/${k}`));
    const [a, b] = await Promise.all([
      getPresignedDownloadUrl('a.png'),
      getPresignedDownloadUrl('b.png'),
    ]);
    expect(a).toBe('https://x/a.png');
    expect(b).toBe('https://x/b.png');
    expect(mockPresignDownloadUrl).toHaveBeenCalledTimes(2);
  });
});

describe('getPresignedDownloadUrl — caching', () => {
  it('serves a repeat request from cache without re-fetching', async () => {
    mockPresignDownloadUrl.mockResolvedValue('https://signed.example/a.png');
    await getPresignedDownloadUrl('a.png');
    await getPresignedDownloadUrl('a.png');
    expect(mockPresignDownloadUrl).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the entry has expired', async () => {
    let t = 1_000_000;
    __setPresignClock(() => t);
    mockPresignDownloadUrl.mockResolvedValue('https://signed.example/a.png');

    await getPresignedDownloadUrl('a.png');
    // Past the 600s cache TTL. Serving a stale URL would render a broken image,
    // since the server-side URL expires at 900s.
    t += 601_000;
    await getPresignedDownloadUrl('a.png');

    expect(mockPresignDownloadUrl).toHaveBeenCalledTimes(2);
  });

  it('still serves from cache just before expiry', async () => {
    let t = 1_000_000;
    __setPresignClock(() => t);
    mockPresignDownloadUrl.mockResolvedValue('https://signed.example/a.png');

    await getPresignedDownloadUrl('a.png');
    t += 599_000;
    await getPresignedDownloadUrl('a.png');

    expect(mockPresignDownloadUrl).toHaveBeenCalledTimes(1);
  });
});

describe('getPresignedDownloadUrl — failures', () => {
  it('propagates the error to the caller', async () => {
    mockPresignDownloadUrl.mockRejectedValue(new Error('AccessDenied'));
    await expect(getPresignedDownloadUrl('a.png')).rejects.toThrow('AccessDenied');
  });

  it('does not cache a failure, so a retry can succeed', async () => {
    mockPresignDownloadUrl
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('https://signed.example/a.png');

    await expect(getPresignedDownloadUrl('a.png')).rejects.toThrow('transient');
    // A permanent negative cache would leave the image broken until reload.
    await expect(getPresignedDownloadUrl('a.png')).resolves.toBe('https://signed.example/a.png');
    expect(mockPresignDownloadUrl).toHaveBeenCalledTimes(2);
  });

  it('rejects all concurrent callers when the shared request fails', async () => {
    mockPresignDownloadUrl.mockRejectedValue(new Error('boom'));
    const a = getPresignedDownloadUrl('a.png');
    const b = getPresignedDownloadUrl('a.png');
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
    expect(mockPresignDownloadUrl).toHaveBeenCalledTimes(1);
  });
});
