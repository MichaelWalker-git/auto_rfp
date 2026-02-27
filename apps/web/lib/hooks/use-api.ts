'use client';

/**
 * Core API hooks — standardized data fetching layer.
 *
 * All domain hooks should use `useApi()` for GET requests and
 * `apiMutate()` / `useMutation()` from `./api-helpers` for mutations.
 *
 * This file re-exports the generic utilities and defines domain-specific
 * GET hooks that are used across multiple features.
 */

import { SWRConfiguration } from 'swr';
import { useApi, buildApiUrl, ApiError, apiFetcher, apiMutate } from './api-helpers';
import { OrganizationItem, AnswerItem, GroupedSection, ProjectItem } from '@auto-rfp/core';
import useSWR from 'swr';
import { useCallback, useEffect, useRef, useState } from 'react';

// Re-export core utilities for backward compatibility
export { useApi, ApiError, apiFetcher, buildApiUrl } from './api-helpers';
export type { UseApiResult } from './api-helpers';

// ─── Multi-Org: Get My Organizations ───

export interface MyOrganization {
  orgId: string;
  orgName: string;
  role: string;
  joinedAt: string;
}

export interface MyOrganizationsResponse {
  organizations: MyOrganization[];
  lastOrgId: string | null;
}

export function useMyOrganizations() {
  return useApi<MyOrganizationsResponse>(
    ['user/my-organizations'],
    buildApiUrl('user/get-my-organizations'),
    { shouldRetryOnError: false, errorRetryCount: 0 },
  );
}

export async function setLastOrg(orgId: string) {
  return apiMutate<{ success: boolean; lastOrgId: string }>(
    buildApiUrl('user/set-last-org'),
    'PUT',
    { orgId },
  );
}

// ─── Domain GET Hooks ───

export function useOrganizations() {
  return useApi<OrganizationItem[]>(
    ['organization/organizations'],
    buildApiUrl('organization/get-organizations'),
  );
}

export function useOrganization(orgId: string | null, includeAll = false) {
  return useApi<OrganizationItem>(
    orgId ? ['organization', orgId, includeAll] : null,
    orgId ? buildApiUrl(`organization/get-organization/${orgId}`, { include: includeAll ? 'all' : undefined }) : null,
  );
}

export function useProjects(orgId: string | null) {
  return useApi<ProjectItem[]>(
    orgId ? ['project/projects', orgId] : null,
    orgId ? buildApiUrl('projects/list', { orgId }) : null,
  );
}

export function useProject(projectId: string | null, includeAll = false) {
  return useApi<ProjectItem>(
    projectId ? ['project', projectId, includeAll] : null,
    projectId ? buildApiUrl(`projects/get/${projectId}`, { include: includeAll ? 'all' : undefined }) : null,
  );
}

export function useQuestions(projectId: string | null, includeAll = false, options?: { refreshInterval?: number }) {
  const config: SWRConfiguration = {
    revalidateIfStale: true,
    dedupingInterval: 5_000,
    focusThrottleInterval: 10_000,
    refreshInterval: options?.refreshInterval,
  };

  return useApi<{ sections: GroupedSection[] }>(
    projectId ? ['questions', projectId, includeAll] : null,
    projectId ? buildApiUrl(`projects/questions/${projectId}`, { include: includeAll ? 'all' : undefined }) : null,
    config,
  );
}

// ─── Paginated Answers Hook ───

interface PaginatedAnswersResponse {
  items: Record<string, AnswerItem>;
  nextToken: string | null;
}

export function useAnswers(projectId: string | null, includeSourceContent = false) {
  const [allAnswers, setAllAnswers] = useState<Record<string, AnswerItem>>({});
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  // Track if we've completed pagination for this projectId to prevent re-fetching on revalidation
  const paginationCompletedRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);

  const buildUrl = useCallback((nextToken?: string) => {
    if (!projectId) return null;
    return buildApiUrl(`answer/get-answers/${projectId}`, {
      limit: 100,
      includeSourceContent: includeSourceContent || undefined,
      nextToken,
    });
  }, [projectId, includeSourceContent]);

  const { data: firstPage, error: firstPageError, isLoading: isFirstPageLoading, mutate } = useSWR<PaginatedAnswersResponse>(
    projectId ? ['answers', projectId, includeSourceContent] : null,
    projectId ? () => apiFetcher<PaginatedAnswersResponse>(buildUrl()!) : null,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 60_000,
      errorRetryCount: 3,
    },
  );

  useEffect(() => {
    // Reset when projectId changes
    if (projectId !== paginationCompletedRef.current) {
      paginationCompletedRef.current = null;
    }

    if (!firstPage) {
      setAllAnswers({});
      return;
    }

    // No pagination needed - just use first page
    if (!firstPage.nextToken) {
      setAllAnswers(firstPage.items);
      paginationCompletedRef.current = projectId;
      return;
    }

    // Skip if we've already completed pagination for this project OR are currently fetching
    if (paginationCompletedRef.current === projectId || isFetchingRef.current) {
      return;
    }

    const fetchRemainingPages = async () => {
      isFetchingRef.current = true;
      setIsLoadingAll(true);
      let merged = { ...firstPage.items };
      let nextToken: string | null = firstPage.nextToken;

      try {
        while (nextToken) {
          const url = buildUrl(nextToken);
          if (!url) break;
          const response = await apiFetcher<PaginatedAnswersResponse>(url);
          merged = { ...merged, ...response.items };
          nextToken = response.nextToken;
        }
        setAllAnswers(merged);
        setError(undefined);
        paginationCompletedRef.current = projectId;
      } catch (err) {
        console.error('Error fetching paginated answers:', err);
        setError(err as ApiError);
        setAllAnswers(merged);
      } finally {
        setIsLoadingAll(false);
        isFetchingRef.current = false;
      }
    };

    fetchRemainingPages();
  }, [firstPage, buildUrl, projectId]);

  useEffect(() => {
    if (firstPageError) setError(firstPageError);
  }, [firstPageError]);

  return {
    data: Object.keys(allAnswers).length > 0 ? allAnswers : (firstPage?.items ?? undefined),
    isLoading: isFirstPageLoading || isLoadingAll,
    isError: !!error,
    error,
    mutate,
  };
}
