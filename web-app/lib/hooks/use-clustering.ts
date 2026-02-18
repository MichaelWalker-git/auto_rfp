'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import {
  QuestionCluster,
  SimilarQuestion,
  ClusterMember,
  GetClustersResponse,
  FindSimilarQuestionsResponse,
  ApplyClusterAnswerRequest,
  ApplyClusterAnswerResponse,
} from '@auto-rfp/shared';

// ---------- Fetchers ----------

async function fetchClusters(projectId: string): Promise<GetClustersResponse> {
  const res = await authFetcher(`${env.BASE_API_URL}/clustering/clusters/${projectId}`, {
    method: 'GET',
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Failed to fetch clusters');
    (err as any).status = res.status;
    throw err;
  }

  return res.json();
}

async function fetchSimilarQuestions(
  projectId: string,
  questionId: string,
  orgId?: string,
  threshold?: number,
  limit?: number
): Promise<FindSimilarQuestionsResponse> {
  const params = new URLSearchParams();
  if (orgId) params.set('orgId', orgId);
  if (threshold) params.set('threshold', threshold.toString());
  if (limit) params.set('limit', limit.toString());
  const queryString = params.toString() ? `?${params.toString()}` : '';

  const res = await authFetcher(
    `${env.BASE_API_URL}/clustering/similar/${projectId}/${questionId}${queryString}`,
    { method: 'GET' }
  );

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Failed to fetch similar questions');
    (err as any).status = res.status;
    throw err;
  }

  return res.json();
}

async function applyClusterAnswer(
  _key: string,
  { arg }: { arg: ApplyClusterAnswerRequest }
): Promise<ApplyClusterAnswerResponse> {
  const res = await authFetcher(`${env.BASE_API_URL}/clustering/apply-answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(arg),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Failed to apply cluster answer');
    (err as any).status = res.status;
    throw err;
  }

  return res.json();
}

// ---------- Hooks ----------

/**
 * Get all clusters for a project
 */
export function useClusters(projectId?: string) {
  return useSWR<GetClustersResponse, Error>(
    projectId ? ['clusters', projectId] : null,
    () => fetchClusters(projectId!),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 30_000,
    }
  );
}

/**
 * Get similar questions for a specific question
 */
export function useSimilarQuestions(
  projectId?: string,
  questionId?: string,
  options?: { threshold?: number; limit?: number; orgId?: string }
) {
  return useSWR<FindSimilarQuestionsResponse, Error>(
    projectId && questionId && options?.orgId
      ? ['similar-questions', projectId, questionId, options.orgId, options?.threshold, options?.limit]
      : null,
    () => fetchSimilarQuestions(projectId!, questionId!, options?.orgId, options?.threshold, options?.limit),
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: true,
      dedupingInterval: 60_000,
    }
  );
}

/**
 * Apply an answer to similar questions (mutation)
 */
export function useApplyClusterAnswer() {
  return useSWRMutation<ApplyClusterAnswerResponse, Error, string, ApplyClusterAnswerRequest>(
    'apply-cluster-answer',
    applyClusterAnswer
  );
}

// ---------- Helpers ----------

/**
 * Helper to get cluster info for a specific question
 */
export function getQuestionClusterInfo(
  clusters: QuestionCluster[],
  questionId: string
): { cluster: QuestionCluster; isMaster: boolean; similarity: number } | null {
  for (const cluster of clusters) {
    if (cluster.masterQuestionId === questionId) {
      return { cluster, isMaster: true, similarity: 1.0 };
    }
    const member = cluster.members.find((m: ClusterMember) => m.questionId === questionId);
    if (member) {
      return { cluster, isMaster: false, similarity: member.similarity };
    }
  }
  return null;
}

/**
 * Helper to check if a question is a cluster master
 */
export function isClusterMaster(clusters: QuestionCluster[], questionId: string): boolean {
  return clusters.some((c) => c.masterQuestionId === questionId);
}

/**
 * Helper to get all similar questions for display
 */
export function getClusterMembers(
  clusters: QuestionCluster[],
  questionId: string
): SimilarQuestion[] {
  const info = getQuestionClusterInfo(clusters, questionId);
  if (!info) return [];

  // Return all other members (excluding self)
  return info.cluster.members
    .filter((m: ClusterMember) => m.questionId !== questionId)
    .map((m: ClusterMember): SimilarQuestion => ({
      questionId: m.questionId,
      questionText: m.questionText,
      sectionId: m.sectionId,
      sectionTitle: m.sectionTitle,
      similarity: m.similarity,
      hasAnswer: m.hasAnswer,
      inSameCluster: true,
      clusterId: info.cluster.clusterId,
    }));
}