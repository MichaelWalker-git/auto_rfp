'use client';

import { useState } from 'react';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type {
  SearchDibbsOpportunitiesRequest,
  SearchDibbsOpportunitiesResponse,
} from '@auto-rfp/core';

export const useDibbsSearch = (orgId: string | undefined) => {
  const [data, setData]       = useState<SearchDibbsOpportunitiesResponse | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError]     = useState<Error | null>(null);

  const search = async (criteria: SearchDibbsOpportunitiesRequest): Promise<void> => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${env.BASE_API_URL}/search-opportunities/dibbs/search-opportunities?orgId=${encodeURIComponent(orgId)}`;
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(criteria),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg || `Search failed: ${res.status}`);
      }
      const json = await res.json() as SearchDibbsOpportunitiesResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Search failed'));
    } finally {
      setLoading(false);
    }
  };

  return { data, isLoading, error, search };
};
