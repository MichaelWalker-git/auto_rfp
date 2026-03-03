'use client';

import useSWR from 'swr';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

// ---------- Types ----------

export interface DeadlineItem {
  type?: string;
  label?: string;
  dateTimeIso?: string;
  rawText?: string;
  timezone?: string;
  notes?: string;
  evidence?: any[];
}

export interface DeadlineRecord {
  PK: string;
  SK: string;
  orgId: string;
  projectId: string;
  projectName?: string;
  opportunityId?: string;
  opportunityTitle?: string;
  deadlines?: DeadlineItem[];
  submissionDeadlineIso?: string;
  hasSubmissionDeadline?: boolean;
  warnings?: string[];
  source?: {
    executiveBriefId: string;
  };
  extractedAt: string;
}

export interface GetDeadlinesParams {
  orgId?: string;
  projectId?: string;
  opportunityId?: string;
  urgentOnly?: boolean;
}

export interface GetDeadlinesResponse {
  ok: boolean;
  count: number;
  deadlines: DeadlineRecord[];
  filters?: {
    orgId: string;
    projectId: string;
    urgentOnly: boolean;
  };
  error?: string;
  message?: string;
}

// ---------- Fetcher ----------

async function fetchDeadlines(params: GetDeadlinesParams): Promise<GetDeadlinesResponse> {
  const searchParams = new URLSearchParams();
  
  if (params.orgId) searchParams.append('orgId', params.orgId);
  if (params.projectId) searchParams.append('projectId', params.projectId);
  if (params.opportunityId) searchParams.append('opportunityId', params.opportunityId);
  if (params.urgentOnly) searchParams.append('urgentOnly', 'true');

  const url = `${env.BASE_API_URL}/deadlines/get-deadlines?${searchParams.toString()}`;

  const res = await authFetcher(url, {
    method: 'GET',
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Failed to fetch deadlines');
    (err as any).status = res.status;
    throw err;
  }

  const data = await res.json();
  return data;
}

// ---------- Hooks ----------

/**
 * Get all deadlines for an organization
 */
export function useOrgDeadlines(orgId?: string, urgentOnly = false) {
  return useSWR<GetDeadlinesResponse, Error>(
    orgId ? ['deadlines', 'org', orgId, urgentOnly] : null,
    () => fetchDeadlines({ orgId, urgentOnly }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );
}

/**
 * Get deadlines for a specific project
 */
export function useProjectDeadlines(projectId?: string) {
  return useSWR<GetDeadlinesResponse, Error>(
    projectId ? ['deadlines', 'project', projectId] : null,
    () => fetchDeadlines({ projectId }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );
}

/**
 * Get deadlines for a specific opportunity
 */
export function useOpportunityDeadlines(projectId?: string, opportunityId?: string) {
  return useSWR<GetDeadlinesResponse, Error>(
    projectId && opportunityId ? ['deadlines', 'opportunity', projectId, opportunityId] : null,
    () => fetchDeadlines({ projectId, opportunityId }),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );
}

/**
 * Generic hook with full control over params
 */
export function useDeadlines(params: GetDeadlinesParams) {
  const key = ['deadlines', params.orgId || 'all', params.projectId || 'all', params.opportunityId || 'all', params.urgentOnly || false];

  return useSWR<GetDeadlinesResponse, Error>(
    key,
    () => fetchDeadlines(params),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
    }
  );
}