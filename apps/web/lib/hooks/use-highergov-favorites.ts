'use client';

import { useState, useCallback } from 'react';
import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HigherGovFavorite = {
  oppKey: string;
  title: string;
  agency: string | null;
  dueDate: string | null;
  postedDate: string | null;
  sourceType: string | null;
  imported: boolean;
  existingOppId: string | null;
};

type FavoritesResponse = {
  configured: boolean;
  pursuits: HigherGovFavorite[];
  unimportedCount: number;
  totalCount: number;
};

type ImportResult = {
  oppKey: string;
  title: string;
  status: 'imported' | 'skipped_duplicate' | 'failed';
  oppId?: string;
  error?: string;
};

type ImportResponse = {
  ok: boolean;
  summary: { total: number; imported: number; skipped: number; failed: number; totalPursuits: number };
  results: ImportResult[];
};

// ─── Check for favorites ─────────────────────────────────────────────────────

export const useHigherGovFavorites = (orgId?: string) => {
  const url = orgId
    ? `${env.BASE_API_URL}/search-opportunities/highergov-favorites?orgId=${encodeURIComponent(orgId)}`
    : null;

  const { data, isLoading, error, mutate } = useSWR<FavoritesResponse>(
    url,
    async (u: string) => {
      try {
        const res = await authFetcher(u);
        if (!res.ok) return { configured: false, pursuits: [], unimportedCount: 0, totalCount: 0 };
        return res.json();
      } catch {
        return { configured: false, pursuits: [], unimportedCount: 0, totalCount: 0 };
      }
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  return {
    favorites: data?.pursuits ?? [],
    unimportedCount: data?.unimportedCount ?? 0,
    totalCount: data?.totalCount ?? 0,
    configured: data?.configured ?? false,
    isLoading,
    error,
    refresh: mutate,
  };
};

// ─── Import favorites ────────────────────────────────────────────────────────

export const useImportHigherGovFavorites = () => {
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const importFavorites = useCallback(async (args: {
    orgId: string;
    projectId: string;
    oppKeys?: string[];
    force?: boolean;
  }) => {
    setIsImporting(true);
    setImportError(null);
    setResult(null);
    try {
      const res = await authFetcher(`${env.BASE_API_URL}/search-opportunities/import-highergov-favorites`, {
        method: 'POST',
        body: JSON.stringify(args),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => 'Import failed');
        throw new Error(text);
      }
      const data = (await res.json()) as ImportResponse;
      setResult(data);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      setImportError(msg);
      throw e;
    } finally {
      setIsImporting(false);
    }
  }, []);

  return { importFavorites, isImporting, result, importError };
};
