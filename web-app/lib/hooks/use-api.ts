'use client';

import useSWR from 'swr';
import { useCallback, useEffect, useState } from 'react';
import { Organization } from '@/app/organizations/page';
import { env } from '@/lib/env';
import { Project } from '@/types/project';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { AnswerItem, GroupedSection } from '@auto-rfp/shared';

class HttpError extends Error {
  status?: number;
  details?: any;
}

interface PaginatedAnswersResponse {
  items: Record<string, AnswerItem>;
  nextToken: string | null;
}

const defineFetcher = async <T>(url: string): Promise<T> => {
  const res = await authFetcher(url);

  if (!res.ok) {
    const err = new HttpError('An error occurred while fetching the data.');
    err.status = res.status;
    try {
      err.details = await res.json();
    } catch {
      // ignore
    }
    throw err;
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
};

export function useApi<T>(key: string | null | any[], url?: string | null) {
  const { data, error, isLoading, mutate } = useSWR<T>(
    url ? key : null,
    url ? () => defineFetcher<T>(url) : null,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 60_000,
      focusThrottleInterval: 60_000,
      errorRetryCount: 3,
      loadingTimeout: 10_000,
    }
  );

  return {
    data,
    isLoading,
    isError: !!error,
    error: error as HttpError | undefined,
    mutate,
  };
}

// ---- domain hooks ----

export function useOrganizations() {
  return useApi<Organization[]>(
    ['organization/organizations'],
    `${env.BASE_API_URL}/organization/get-organizations`,
  );
}

export function useOrganization(orgId: string | null, includeAll = false) {
  const params = includeAll ? '?include=all' : '';
  return useApi<any>(
    orgId ? ['organization', orgId, includeAll] : null,
    orgId ? `${env.BASE_API_URL}/organization/get-organization/${orgId}${params}` : null,
  );
}

export function useProjects(orgId: string | null) {
  return useApi<Project[]>(
    orgId ? ['project/projects', orgId] : null, // ✅ include orgId in key
    orgId ? `${env.BASE_API_URL}/projects/list?orgId=${orgId}` : null,
  );
}

export function useProject(projectId: string | null, includeAll = false) {
  const params = includeAll ? '?include=all' : '';
  return useApi<any>(
    projectId ? ['project', projectId, includeAll] : null,
    projectId ? `${env.BASE_API_URL}/projects/get/${projectId}${params}` : null,
  );
}

export function useQuestions(projectId: string | null, includeAll = false, options?: { refreshInterval?: number }) {
  const params = includeAll ? '?include=all' : '';
  const url = projectId ? `${env.BASE_API_URL}/projects/questions/${projectId}${params}` : null;
  
  const { data, error, isLoading, mutate } = useSWR<{ sections: GroupedSection[] }>(
    projectId ? ['questions', projectId, includeAll] : null,
    url ? () => defineFetcher<{ sections: GroupedSection[] }>(url) : null,
    {
      revalidateOnFocus: false,
      revalidateIfStale: true, // Allow revalidation when stale
      dedupingInterval: 5_000, // Reduced from 60s to 5s for faster updates
      focusThrottleInterval: 10_000,
      errorRetryCount: 3,
      refreshInterval: options?.refreshInterval, // Optional polling for extraction progress
    }
  );

  return {
    data,
    isLoading,
    isError: !!error,
    error: error as HttpError | undefined,
    mutate,
  };
}

/**
 * Hook to fetch all answers for a project with automatic pagination handling.
 * Fetches all pages and merges them into a single Record<string, AnswerItem>.
 */
export function useAnswers(projectId: string | null, includeSourceContent = false) {
  const [allAnswers, setAllAnswers] = useState<Record<string, AnswerItem>>({});
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [error, setError] = useState<HttpError | undefined>(undefined);

  // Build query params
  const buildUrl = useCallback((nextToken?: string) => {
    if (!projectId) return null;
    const params = new URLSearchParams();
    params.set('limit', '100'); // Fetch in batches of 100
    if (includeSourceContent) {
      params.set('includeSourceContent', 'true');
    }
    if (nextToken) {
      params.set('nextToken', nextToken);
    }
    return `${env.BASE_API_URL}/answer/get-answers/${projectId}?${params.toString()}`;
  }, [projectId, includeSourceContent]);

  // Fetch first page using SWR for caching
  const { data: firstPage, error: firstPageError, isLoading: isFirstPageLoading, mutate } = useSWR<PaginatedAnswersResponse>(
    projectId ? ['answers', projectId, includeSourceContent] : null,
    projectId ? () => defineFetcher<PaginatedAnswersResponse>(buildUrl()!) : null,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 60_000,
      focusThrottleInterval: 60_000,
      errorRetryCount: 3,
      loadingTimeout: 10_000,
    }
  );

  // Fetch remaining pages when first page has nextToken
  useEffect(() => {
    if (!firstPage) {
      setAllAnswers({});
      return;
    }

    // Start with first page items
    let merged = { ...firstPage.items };

    // If no more pages, we're done
    if (!firstPage.nextToken) {
      setAllAnswers(merged);
      return;
    }

    // Fetch remaining pages
    const fetchRemainingPages = async () => {
      setIsLoadingAll(true);
      let nextToken: string | null = firstPage.nextToken;

      try {
        while (nextToken) {
          const url = buildUrl(nextToken);
          if (!url) break;

          const response = await defineFetcher<PaginatedAnswersResponse>(url);
          merged = { ...merged, ...response.items };
          nextToken = response.nextToken;
        }

        setAllAnswers(merged);
        setError(undefined);
      } catch (err) {
        console.error('Error fetching paginated answers:', err);
        setError(err as HttpError);
        // Still set what we have so far
        setAllAnswers(merged);
      } finally {
        setIsLoadingAll(false);
      }
    };

    fetchRemainingPages();
  }, [firstPage, buildUrl]);

  // Handle first page error
  useEffect(() => {
    if (firstPageError) {
      setError(firstPageError);
    }
  }, [firstPageError]);

  return {
    data: Object.keys(allAnswers).length > 0 ? allAnswers : (firstPage?.items ?? undefined),
    isLoading: isFirstPageLoading || isLoadingAll,
    isError: !!error,
    error,
    mutate,
  };
}
