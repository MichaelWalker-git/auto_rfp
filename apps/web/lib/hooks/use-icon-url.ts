'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

const CACHE_PREFIX = 'auto-rfp:icon-cache:';
const CACHE_TTL_MS = 50 * 60 * 1000; // 50 minutes (presigned URLs expire in 60 min)

interface CachedIcon {
  url: string;
  expiresAt: number;
}

function getCachedUrl(key: string): string | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const cached: CachedIcon = JSON.parse(raw);
    if (Date.now() > cached.expiresAt) {
      localStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    return cached.url;
  } catch {
    return null;
  }
}

function setCachedUrl(key: string, url: string): void {
  try {
    const cached: CachedIcon = { url, expiresAt: Date.now() + CACHE_TTL_MS };
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(cached));
  } catch {
    // localStorage full or unavailable
  }
}

async function fetchPresignedUrl(key: string): Promise<string | null> {
  try {
    const res = await authFetcher(`${env.BASE_API_URL}/presigned/presigned-url`, {
      method: 'POST',
      body: JSON.stringify({ operation: 'download', key }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.url;
    }
  } catch {
    // Silently fail
  }
  return null;
}

/**
 * Resolves a single S3 key to a presigned download URL.
 * Caches in localStorage with TTL to avoid expiration issues.
 */
export function useIconUrl(iconKey: string | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(() => {
    if (!iconKey) return null;
    return getCachedUrl(iconKey);
  });
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!iconKey) {
      setUrl(null);
      lastKeyRef.current = null;
      return;
    }

    if (lastKeyRef.current === iconKey) return;
    lastKeyRef.current = iconKey;

    // Check cache first
    const cached = getCachedUrl(iconKey);
    if (cached) {
      setUrl(cached);
      return;
    }

    let cancelled = false;

    (async () => {
      const presignedUrl = await fetchPresignedUrl(iconKey);
      if (presignedUrl && !cancelled) {
        setCachedUrl(iconKey, presignedUrl);
        setUrl(presignedUrl);
      }
    })();

    return () => { cancelled = true; };
  }, [iconKey]);

  return url;
}

/**
 * Resolves multiple S3 keys to presigned URLs.
 * Caches in localStorage. Returns a map of key → url.
 */
export function useIconUrls(iconKeys: (string | undefined | null)[]): Record<string, string> {
  const [urlMap, setUrlMap] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const key of iconKeys) {
      if (!key) continue;
      const cached = getCachedUrl(key);
      if (cached) initial[key] = cached;
    }
    return initial;
  });

  const keysStr = useMemo(() => iconKeys.filter(Boolean).sort().join(','), [iconKeys]);

  useEffect(() => {
    const keysToResolve = iconKeys.filter(
      (k): k is string => !!k && !getCachedUrl(k),
    );

    if (keysToResolve.length === 0) return;

    let cancelled = false;

    (async () => {
      const newEntries: Record<string, string> = {};

      await Promise.all(
        keysToResolve.map(async (key) => {
          const url = await fetchPresignedUrl(key);
          if (url) {
            setCachedUrl(key, url);
            newEntries[key] = url;
          }
        }),
      );

      if (!cancelled && Object.keys(newEntries).length > 0) {
        setUrlMap((prev) => ({ ...prev, ...newEntries }));
      }
    })();

    return () => { cancelled = true; };
  }, [keysStr]);

  return urlMap;
}