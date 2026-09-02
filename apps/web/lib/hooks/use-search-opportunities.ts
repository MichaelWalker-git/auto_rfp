'use client';

import { useRef, useState } from 'react';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { SearchOpportunity } from '@auto-rfp/core';

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
  sources?: Array<'SAM_GOV' | 'DIBBS' | 'HIGHER_GOV'>;
  /** HigherGov source_type filter: 'sam', 'dibbs', 'sbir', 'grant', 'sled' */
  higherGovSourceType?: string;
  /** HigherGov search_id — replay a saved search from HigherGov UI */
  higherGovSearchId?: string;
  /** Which HigherGov market(s) to search — their MCP `opportunity_type`. */
  higherGovMarket?: HigherGovMarket;
  /** Restrict HigherGov to currently open opportunities. */
  higherGovActiveOnly?: boolean;
  limit?: number;
  offset?: number;
}

/** Mirrors the `opportunity_type` enum of HigherGov's MCP `search_opportunities` tool. */
export type HigherGovMarket =
  | 'federal_contract'
  | 'state_local'
  | 'federal_and_state_local'
  | 'federal_grant'
  | 'dibbs'
  | 'sbir'
  | 'federal_forecast'
  | 'sled_forecast'
  | 'all';

/** @deprecated use SearchOpportunityCriteria */
export type UnifiedSearchCriteria = SearchOpportunityCriteria;

export interface SearchOpportunityResult {
  opportunities: SearchOpportunity[];
  totalSamGov: number;
  totalDibbs: number;
  totalHigherGov: number;
  total: number;
  errors?: Record<string, string>;
  samGovError: string | null;
  dibbsError: string | null;
  higherGovError: string | null;
  /** A HigherGov saved-search fetch is still running in the background. */
  higherGovPending: boolean;
}

/** @deprecated use SearchOpportunityResult */
export type UnifiedSearchResult = SearchOpportunityResult;

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * `yyyy-MM-dd` → `MM/dd/yyyy`, by string surgery rather than via `new Date()`.
 *
 * `new Date('2026-08-01')` is parsed as UTC midnight, so the local getters report
 * 2026-07-31 for anyone west of UTC — a date the user picked was sent as the day before.
 * The same trap is already documented in search-criteria-url.ts and SearchOpportunityForm.
 */
const toMMDDYYYY = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  // Non-ISO input (e.g. an already-formatted or Date-stringified value): fall back to
  // local-time getters, which are correct for those shapes.
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

/**
 * Poll cadence + ceiling for a background HigherGov saved-search fetch. The
 * worker Lambda has a 60s timeout; a cold first fetch that times out is auto-
 * retried by Lambda and can complete ~90s+ after the paste. Poll long enough to
 * catch that worst case so results appear on the first paste, not a re-search.
 */
const HIGHERGOV_POLL_INTERVAL_MS = 4_000;
const HIGHERGOV_POLL_MAX_ATTEMPTS = 30; // ~120s of polling before giving up

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useSearchOpportunities = (orgId: string | undefined) => {
  const [result, setResult]           = useState<SearchOpportunityResult | null>(null);
  const [isLoading, setLoading]       = useState(false);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [error, setError]             = useState<Error | null>(null);
  // Track the last criteria so "load more" can re-use it
  const [lastCriteria, setLastCriteria] = useState<SearchOpportunityCriteria | null>(null);
  const [currentOffset, setCurrentOffset] = useState(0);
  // Incremented on each new search so a stale poll loop from a prior search
  // (e.g. the user changed the query mid-fetch) knows to stop.
  const searchTokenRef = useRef(0);

  const fetchPage = async (
    criteria: SearchOpportunityCriteria,
    offset: number,
    append: boolean,
  ): Promise<boolean> => {
    if (!orgId) return false;

    const source = criteria.sources?.length === 1 ? criteria.sources[0] : 'ALL';
    const limit  = criteria.limit ?? DEFAULT_PAGE_SIZE;

    // SAM.gov REQUIRES a posted range, so it keeps the 30-day fallback. HigherGov must
    // NOT get one: the backend maps postedFrom to their `posted_date`, which is a SINGLE
    // DAY, so a defaulted "30 days ago" asks for opportunities posted on exactly that day
    // and returns nothing. Measured: `keyword=saas` alone -> 310, with the defaulted date
    // -> 0. The form deliberately leaves these undefined for HigherGov; re-adding them
    // here silently undid that.
    const isHigherGovOnly = source === 'HIGHER_GOV';
    const from = criteria.postedFrom ?? (isHigherGovOnly ? undefined : defaultFrom());
    const to   = criteria.postedTo   ?? (isHigherGovOnly ? undefined : defaultTo());

    const res = await authFetcher(
      `${env.BASE_API_URL}/search-opportunities/search?orgId=${encodeURIComponent(orgId)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          source,
          keywords:     criteria.keywords || undefined,
          naics:        criteria.naics?.length ? criteria.naics : undefined,
          setAsideCode: criteria.setAsideCode || undefined,
          postedFrom:   from ? toMMDDYYYY(from) : undefined,
          postedTo:     to   ? toMMDDYYYY(to)   : undefined,
          closingFrom:  criteria.closingFrom ? toMMDDYYYY(criteria.closingFrom) : undefined,
          closingTo:    criteria.closingTo   ? toMMDDYYYY(criteria.closingTo)   : undefined,
          higherGovSourceType: criteria.higherGovSourceType || undefined,
          higherGovSearchId: criteria.higherGovSearchId || undefined,
          higherGovMarket: criteria.higherGovMarket || undefined,
          higherGovActiveOnly: criteria.higherGovActiveOnly,
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
      opportunities: SearchOpportunity[];
      totalSamGov: number;
      totalDibbs: number;
      totalHigherGov: number;
      total: number;
      errors?: Record<string, string>;
      higherGovPending?: boolean;
    };

    const incoming = json.opportunities ?? [];
    const higherGovPending = json.higherGovPending ?? false;

    setResult((prev) => ({
      opportunities: append && prev ? [...prev.opportunities, ...incoming] : incoming,
      totalSamGov:    json.totalSamGov    ?? 0,
      totalDibbs:     json.totalDibbs     ?? 0,
      totalHigherGov: json.totalHigherGov ?? 0,
      total:          json.total          ?? 0,
      errors:         json.errors,
      samGovError:    json.errors?.['SAM_GOV']    ?? null,
      dibbsError:     json.errors?.['DIBBS']      ?? null,
      higherGovError: json.errors?.['HIGHER_GOV'] ?? null,
      higherGovPending,
    }));
    setCurrentOffset(offset + incoming.length);
    return higherGovPending;
  };

  const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * Re-issue the same search on an interval until the HigherGov background fetch
   * completes (higherGovPending clears) or we hit the attempt ceiling. A new
   * search bumps searchTokenRef, which halts any in-flight poll loop.
   */
  const pollHigherGov = async (criteria: SearchOpportunityCriteria, token: number): Promise<void> => {
    for (let attempt = 0; attempt < HIGHERGOV_POLL_MAX_ATTEMPTS; attempt++) {
      await sleep(HIGHERGOV_POLL_INTERVAL_MS);
      if (token !== searchTokenRef.current) return; // superseded by a newer search
      try {
        const stillPending = await fetchPage(criteria, 0, false);
        if (!stillPending) return;
      } catch {
        return; // transient error — stop polling, keep whatever we already showed
      }
    }
  };

  const search = async (criteria: SearchOpportunityCriteria): Promise<void> => {
    const token = ++searchTokenRef.current;
    setLoading(true);
    setError(null);
    setLastCriteria(criteria);
    setCurrentOffset(0);
    try {
      const higherGovPending = await fetchPage(criteria, 0, false);
      setLoading(false);
      if (higherGovPending) await pollHigherGov(criteria, token);
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Search failed'));
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
