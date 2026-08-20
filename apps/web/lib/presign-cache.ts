'use client';

import { PRESIGN_TTL_SECONDS, presignDownloadUrl } from '@/lib/hooks/use-presign';

/**
 * Process-wide cache for presigned S3 download URLs.
 *
 * ## Why this exists
 *
 * `usePresignDownload` wraps `useSWRMutation` keyed on one constant URL, and SWR
 * aborts an in-flight trigger when a new one starts on the same key. A single hook
 * instance was being shared by the body editor, the header preview, the footer
 * preview and the in-canvas overlay, so concurrent resolutions cancelled each
 * other and whichever lost the race rendered as a broken image.
 *
 * This resolves each key exactly once and hands the same promise to every caller,
 * so concurrency is a non-issue and the number of network calls drops to one per
 * distinct image rather than one per consumer.
 *
 * ## Expiry
 *
 * Presigned URLs are valid for `PRESIGN_TTL_SECONDS` (900s server-side). Entries
 * are expired early, at `CACHE_TTL_MS`, so a long editing session re-presigns
 * before the URL dies rather than silently showing broken images.
 */

/** Expire well before the server's 900s, leaving room for a slow session. */
const CACHE_TTL_MS = (PRESIGN_TTL_SECONDS - 300) * 1000;

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const resolved = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<string>>();

/** Injectable clock, so tests can advance time without waiting. */
let now = (): number => Date.now();

/**
 * Resolve one S3 key to a viewable URL, deduping concurrent callers.
 *
 * Rejections are not cached: the in-flight entry is cleared on failure so a later
 * attempt can retry rather than the key being permanently marked broken.
 */
export const getPresignedDownloadUrl = async (key: string): Promise<string> => {
  const cached = resolved.get(key);
  if (cached && cached.expiresAt > now()) return cached.url;

  // Someone is already fetching this key — share their promise rather than
  // starting a second request that would race the first.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = presignDownloadUrl(key)
    .then((url) => {
      resolved.set(key, { url, expiresAt: now() + CACHE_TTL_MS });
      inFlight.delete(key);
      return url;
    })
    .catch((err) => {
      inFlight.delete(key);
      throw err;
    });

  inFlight.set(key, request);
  return request;
};

/** Test-only: reset all cached state. */
export const __resetPresignCache = (): void => {
  resolved.clear();
  inFlight.clear();
  now = () => Date.now();
};

/** Test-only: override the clock to exercise expiry. */
export const __setPresignClock = (clock: () => number): void => {
  now = clock;
};
