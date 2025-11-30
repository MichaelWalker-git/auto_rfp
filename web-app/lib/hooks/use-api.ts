import useSWR from 'swr';
import { fetchAuthSession } from 'aws-amplify/auth';
import { Organization } from '@/app/organizations/page';
import { env } from '@/lib/env'
import { Project } from '@/types/project';

const fetcher = async (url: string) => {
  let token: string | undefined;

  if (typeof window !== 'undefined') {
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString(); // or idToken
  }

  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const error: any = new Error('An error occurred while fetching the data.');
    error.status = res.status;
    throw error;
  }

  return res.json();
};

export function useApi<T>(key: string | null | Array<any>, url?: string | null) {
  // Support array-based cache keys for better SWR cache management
  const finalUrl = typeof key === 'string' ? key : url;
  
  const { data, error, isLoading, mutate } = useSWR<T>(
    key, 
    typeof finalUrl === 'string' ? () => fetcher(finalUrl) : null,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 60000, // 1 minute deduping
      focusThrottleInterval: 60000, // Don't revalidate more than once per minute
      errorRetryCount: 3,
      loadingTimeout: 10000, // 10 seconds timeout
    }
  );

  return {
    data,
    isLoading,
    isError: !!error,
    error,
    mutate
  };
}

export function useOrganizations() {
  return useApi<Organization[]>(['organization/organizations'], `${env.BASE_API_URL}/organization/get-organizations`);
}

export function useOrganization(orgId: string | null, includeAll = false) {
  const params = includeAll ? '?include=all' : '';
  return useApi<any>(
    orgId ? ['organization', orgId, includeAll] : null,
    orgId ? `${env.BASE_API_URL}/organization/get-organization/${orgId}${params}` : null
  );
}

export function useProjects(orgId: string) {
  return useApi<Project[]>(['project/projects'], `${env.BASE_API_URL}/project/get-projects?orgId=${orgId}`);
}

export function useProject(projectId: string, includeAll = false) {
  const params = includeAll ? '?include=all' : '';
  return useApi<any>(
    projectId ? ['project', projectId, includeAll] : null,
    projectId ? `${env.BASE_API_URL}/project/get-project/${projectId}${params}` : null
  );
}

export function useQuestions(projectId: string | null, includeAll = false) {
  const params = includeAll ? '?include=all' : '';
  return useApi<any>(
    projectId ? ['questions', projectId, includeAll] : null,
    projectId ? `${env.BASE_API_URL}/project/get-questions/${projectId}${params}` : null
  );
}

export function useOrganizationProjects(orgId: string | null) {
  return useApi<any[]>(
    orgId ? ['projects', orgId] : null,
    orgId ? `${env.BASE_API_URL}/project/get-projects?orgId=${orgId}` : null
  );
}

export interface TextExtractionPayload {
  s3Key: string;
  s3Bucket?: string;
  [key: string]: any;
}

export interface TextExtractionResponse {
  jobId: string
}

/**
 * Internal fetcher for text extraction.
 * Sends POST with payload (at least { s3Key }) and returns parsed JSON.
 */
const textExtractionFetcher = async <T>(
  url: string,
  payload: TextExtractionPayload,
): Promise<T> => {
  let token: string | undefined;

  if (typeof window !== 'undefined') {
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString();
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const error: any = new Error('An error occurred while extracting text.');
    error.status = res.status;
    // optionally include backend error message
    try {
      const errJson = await res.json();
      error.details = errJson;
    } catch {
      // ignore json parse error
    }
    throw error;
  }

  return res.json();
};


export function useOrganizationMembers(orgId: string | null) {
  return useApi<any[]>(
    orgId ? ['organization-members', orgId] : null,
    orgId ? `${env.BASE_API_URL}/organization/get-organization-members/${orgId}` : null
  );
} 