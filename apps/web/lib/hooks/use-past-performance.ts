import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type {
  PastProject,
  CreatePastProjectDTO,
  UpdatePastProjectDTO,
  PastPerformanceSection,
  GapAnalysis,
} from '@auto-rfp/core';

const BASE_URL = `${env.BASE_API_URL}/pastperf`;

// ================================
// Types
// ================================

interface ListPastProjectsResponse {
  ok: boolean;
  items: PastProject[];
  nextToken?: string;
  total: number;
}

interface PastProjectResponse {
  ok: boolean;
  project: PastProject;
}

interface MatchProjectsResponse {
  ok: boolean;
  cached?: boolean;
  pastPerformance: PastPerformanceSection;
}

interface GapAnalysisResponse {
  ok: boolean;
  gapAnalysis: GapAnalysis;
  aiRecommendations?: {
    recommendations: Array<{
      gap: string;
      severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      recommendation: string;
      potentialPartners: string[];
      mitigationStrategy?: string;
    }>;
    overallAssessment: string;
    bidRecommendation: 'PROCEED' | 'PROCEED_WITH_CAUTION' | 'CONSIDER_NO_BID' | 'NO_BID';
    bidRationale: string;
  };
  summary: {
    overallCoverage: number;
    totalRequirements: number;
    covered: number;
    partial: number;
    gaps: number;
    criticalGaps: number;
    matchedProjects: number;
  };
}

interface NarrativeResponse {
  ok: boolean;
  projectId?: string;
  narrative?: string;
  keyStrengths?: string[];
  relevantAchievements?: string[];
  clientSatisfaction?: string;
  narratives?: Array<{
    projectId: string;
    narrative: {
      narrative: string;
      keyStrengths: string[];
      relevantAchievements: string[];
      clientSatisfaction?: string;
    };
  }>;
}

// ================================
// Helper
// ================================

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Request failed: ${res.status} - ${errorText}`);
  }
  return res.json();
}

// ================================
// List Past Projects Hook
// ================================

export function useListPastProjects(orgId: string | undefined, includeArchived = false) {
  const fetcher = async () => {
    if (!orgId) return null;
    return postJson<ListPastProjectsResponse>(`${BASE_URL}/list-projects`, {
      orgId,
      includeArchived,
    });
  };

  const { data, error, isLoading, mutate } = useSWR(
    orgId ? ['past-projects', orgId, includeArchived] : null,
    fetcher
  );

  return {
    projects: data?.items || [],
    total: data?.total || 0,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

// ================================
// Get Past Project Hook
// ================================

export function usePastProject(orgId: string | undefined, projectId: string | undefined) {
  const fetcher = async () => {
    if (!orgId || !projectId) return null;
    return postJson<PastProjectResponse>(`${BASE_URL}/get-project`, {
      orgId,
      projectId,
    });
  };

  const { data, error, isLoading, mutate } = useSWR(
    orgId && projectId ? ['past-project', orgId, projectId] : null,
    fetcher
  );

  return {
    project: data?.project,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

// ================================
// Create Past Project Hook
// ================================

export function useCreatePastProject() {
  const { trigger, isMutating, error } = useSWRMutation(
    'create-past-project',
    async (_key: string, { arg }: { arg: CreatePastProjectDTO }) => {
      return postJson<PastProjectResponse>(`${BASE_URL}/create-project`, arg);
    }
  );

  return {
    trigger,
    isLoading: isMutating,
    error,
  };
}

// ================================
// Update Past Project Hook
// ================================

export function useUpdatePastProject() {
  const { trigger, isMutating, error } = useSWRMutation(
    'update-past-project',
    async (_key: string, { arg }: { arg: { orgId: string; projectId: string; updates: UpdatePastProjectDTO } }) => {
      return postJson<PastProjectResponse>(`${BASE_URL}/update-project`, arg);
    }
  );

  return {
    trigger,
    isLoading: isMutating,
    error,
  };
}

// ================================
// Delete Past Project Hook
// ================================

export function useDeletePastProject() {
  const { trigger, isMutating, error } = useSWRMutation(
    'delete-past-project',
    async (_key: string, { arg }: { arg: { orgId: string; projectId: string; hardDelete?: boolean } }) => {
      return postJson<{ ok: boolean; message: string }>(`${BASE_URL}/delete-project`, arg);
    }
  );

  return {
    trigger,
    isLoading: isMutating,
    error,
  };
}

// ================================
// Match Projects Hook
// ================================

export function useMatchProjects() {
  const { trigger, isMutating, error } = useSWRMutation(
    'match-projects',
    async (_key: string, { arg }: { arg: { executiveBriefId: string; topK?: number; force?: boolean } }) => {
      return postJson<MatchProjectsResponse>(`${BASE_URL}/match-projects`, arg);
    }
  );

  return {
    trigger,
    isLoading: isMutating,
    error,
  };
}

// ================================
// Generate Narrative Hook
// ================================

export function useGenerateNarrative() {
  const { trigger, isMutating, error } = useSWRMutation(
    'generate-narrative',
    async (_key: string, { arg }: { arg: { executiveBriefId: string; projectId?: string; force?: boolean } }) => {
      return postJson<NarrativeResponse>(`${BASE_URL}/generate-narrative`, arg);
    }
  );

  return {
    trigger,
    isLoading: isMutating,
    error,
  };
}

// ================================
// Gap Analysis Hook
// ================================

export function useGapAnalysis() {
  const { trigger, isMutating, error } = useSWRMutation(
    'gap-analysis',
    async (_key: string, { arg }: { arg: { executiveBriefId: string; force?: boolean } }) => {
      return postJson<GapAnalysisResponse>(`${BASE_URL}/gap-analysis`, arg);
    }
  );

  return {
    trigger,
    isLoading: isMutating,
    error,
  };
}