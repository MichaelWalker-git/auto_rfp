'use client';

import { useState } from 'react';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { SearchOpportunitySlim } from '@auto-rfp/core';

// ─── Criteria type ────────────────────────────────────────────────────────────

export interface SearchOpportunityCriteria {
  keywords?: string;
  /** ISO date string e.g. "2025-01-01" */
  postedFrom?: string;
  postedTo?: string;
  /** Closing/response-deadline from (ISO date string). Maps to rdlfrom for SAM.gov, closingFrom for DIBBS. */
  closingFrom?: string;
  /** Closing/response-deadline to (ISO date string). Maps to closingTo for DIBBS. */
  closingTo?: string;
  naics?: string[];
  setAsideCode?: string;
  /** Filter to specific sources; undefined = all configured sources */
  sources?: Array<'SAM_GOV' | 'DIBBS'>;
  limit?: number;
  offset?: number;
}

/** @deprecated use SearchOpportunityCriteria */
export type UnifiedSearchCriteria = SearchOpportunityCriteria;

export interface SearchOpportunityResult {
  opportunities: SearchOpportunitySlim[];
  totalSamGov: number;
  totalDibbs: number;
  total: number;
  errors?: Record<string, string>;
  samGovError: string | null;
  dibbsError: string | null;
}

/** @deprecated use SearchOpportunityResult */
export type UnifiedSearchResult = SearchOpportunityResult;

// ─── Date helpers ─────────────────────────────────────────────────────────────

const toMMDDYYYY = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
};

const defaultFrom = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
};

const defaultTo = (): string => new Date().toISOString().slice(0, 10);

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type PageSizeOption = typeof PAGE_SIZE_OPTIONS[number];
const DEFAULT_PAGE_SIZE: PageSizeOption = 25;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useSearchOpportunities = (orgId: string | undefined) => {
  const [result, setResult]           = useState<SearchOpportunityResult | null>(null);
  const [isLoading, setLoading]       = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError]             = useState<Error | null>(null);
  // Track the last criteria so "load more" can re-use it
  const [lastCriteria, setLastCriteria] = useState<SearchOpportunityCriteria | null>(null);
  const [currentOffset, setCurrentOffset] = useState(0);

  const fetchPage = async (
    criteria: SearchOpportunityCriteria,
    offset: number,
    append: boolean,
  ): Promise<void> => {
    if (!orgId) return;

    const from   = criteria.postedFrom ?? defaultFrom();
    const to     = criteria.postedTo   ?? defaultTo();
    const source = criteria.sources?.length === 1 ? criteria.sources[0] : 'ALL';
    const limit  = criteria.limit ?? DEFAULT_PAGE_SIZE;

    const res = await authFetcher(
      `${env.BASE_API_URL}/search-opportunities/search?orgId=${encodeURIComponent(orgId)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          source,
          keywords:     criteria.keywords || undefined,
          naics:        criteria.naics?.length ? criteria.naics : undefined,
          setAsideCode: criteria.setAsideCode || undefined,
          postedFrom:   toMMDDYYYY(from),
          postedTo:     toMMDDYYYY(to),
          closingFrom:  criteria.closingFrom ? toMMDDYYYY(criteria.closingFrom) : undefined,
          closingTo:    criteria.closingTo   ? toMMDDYYYY(criteria.closingTo)   : undefined,
          limit,
          offset,
        }),
      },
    );

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `Search failed: ${res.status}`);
    }

    const json = await res.json() as {
      opportunities: SearchOpportunitySlim[];
      totalSamGov: number;
      totalDibbs: number;
      total: number;
      errors?: Record<string, string>;
    };

    const incoming = json.opportunities ?? [];

    setResult((prev) => ({
      opportunities: append && prev ? [...prev.opportunities, ...incoming] : incoming,
      totalSamGov:   json.totalSamGov ?? 0,
      totalDibbs:    json.totalDibbs  ?? 0,
      total:         json.total       ?? 0,
      errors:        json.errors,
      samGovError:   json.errors?.['SAM_GOV'] ?? null,
      dibbsError:    json.errors?.['DIBBS']   ?? null,
    }));
    setCurrentOffset(offset + incoming.length);
  };

  const search = async (criteria: SearchOpportunityCriteria): Promise<void> => {
    setLoading(true);
    setError(null);
    setLastCriteria(criteria);
    setCurrentOffset(0);
    try {
      await fetchPage(criteria, 0, false);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Search failed'));
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async (): Promise<void> => {
    if (!lastCriteria || isLoading || isLoadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      await fetchPage(lastCriteria, currentOffset, true);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Load more failed'));
    } finally {
      setLoadingMore(false);
    }
  };

  const hasMore = result !== null && result.opportunities.length < result.total;

  return { result, isLoading, isLoadingMore, hasMore, error, search, loadMore };
};
