'use client';

import useSWR from 'swr';
import { Organization } from '@/app/organizations/page';
import { env } from '@/lib/env';
import { Project } from '@/types/project';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { AnswerItem, GroupedSection } from '@auto-rfp/shared';
class HttpError extends Error {
  status?: number;
  details?: any;
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

export function useQuestions(projectId: string | null, includeAll = false) {
  const params = includeAll ? '?include=all' : '';
  return useApi<{ sections: GroupedSection[] }>(
    projectId ? ['questions', projectId, includeAll] : null,
    projectId ? `${env.BASE_API_URL}/projects/questions/${projectId}${params}` : null,
  );
}

export function useAnswers(projectId: string | null, includeAll = false) {
  const params = includeAll ? '?include=all' : '';
  return useApi<Record<string, AnswerItem>>(
    projectId ? ['answers', projectId, includeAll] : null,
    projectId ? `${env.BASE_API_URL}/answer/get-answers/${projectId}${params}` : null,
  );
}
