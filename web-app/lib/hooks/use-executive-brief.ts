'use client';

import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

import type { ExecutiveBriefItem, } from '@auto-rfp/shared';

export type InitExecutiveBriefRequest = {
  projectId: string;
};

export type InitExecutiveBriefResponse = {
  ok: boolean;
  projectId?: string;
  executiveBriefId?: string;
  questionFileId?: string;
  textKey?: string;
  message?: string;
  error?: string;
};

// If BriefSectionName isn't exported from shared, keep this union
export type SectionName =
  | 'summary'
  | 'deadlines'
  | 'contacts'
  | 'requirements'
  | 'risks'
  | 'scoring';

export type GenerateSectionRequest = {
  executiveBriefId: string;
  force?: boolean;
  topK?: number;
};

export type GenerateSectionResponse = {
  ok: boolean;
  executiveBriefId?: string;
  section?: SectionName;
  status?: string;
  reused?: boolean;
  // some endpoints might return these
  compositeScore?: number;
  recommendation?: 'GO' | 'NO_GO' | 'NEEDS_REVIEW';
  confidence?: number;
  overallStatus?: string;

  message?: string;
  error?: string;
};

// For read-by-project endpoint
export type GetExecutiveBriefByProjectRequest = {
  projectId: string;
};

export type GetExecutiveBriefByProjectResponse = {
  ok: boolean;
  projectId?: string;
  executiveBriefId?: string;
  brief?: ExecutiveBriefItem; // ✅ shared type
  message?: string;
  error?: string;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    const err = new Error(raw || 'Request failed');
    (err as any).status = res.status;
    throw err;
  }

  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true } as T;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return { ok: true } as T;
  }
}

const endpoints = {
  init: `${env.BASE_API_URL}/brief/init-executive-brief`,
  summary: `${env.BASE_API_URL}/brief/generate-executive-brief-summary`,
  deadlines: `${env.BASE_API_URL}/brief/generate-executive-brief-deadlines`,
  contacts: `${env.BASE_API_URL}/brief/generate-executive-brief-contacts`,
  requirements: `${env.BASE_API_URL}/brief/generate-executive-brief-requirements`,
  risks: `${env.BASE_API_URL}/brief/generate-executive-brief-risks`,
  scoring: `${env.BASE_API_URL}/brief/generate-executive-brief-scoring`,
  getByProject: `${env.BASE_API_URL}/brief/get-executive-brief-by-project`,
} as const;

// ---------- hooks ----------
export function useInitExecutiveBrief() {
  return useSWRMutation<InitExecutiveBriefResponse, Error, string, InitExecutiveBriefRequest>(
    endpoints.init,
    (url, { arg }) => postJson<InitExecutiveBriefResponse>(url, arg),
  );
}

export function useGenerateExecutiveBriefSummary() {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.summary,
    (url, { arg }) => postJson<GenerateSectionResponse>(url, arg),
  );
}

export function useGenerateExecutiveBriefDeadlines() {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.deadlines,
    (url, { arg }) => postJson<GenerateSectionResponse>(url, arg),
  );
}

export function useGenerateExecutiveBriefContacts() {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.contacts,
    (url, { arg }) => postJson<GenerateSectionResponse>(url, arg),
  );
}

export function useGenerateExecutiveBriefRequirements() {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.requirements,
    (url, { arg }) => postJson<GenerateSectionResponse>(url, arg),
  );
}

export function useGenerateExecutiveBriefRisks() {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.risks,
    (url, { arg }) => postJson<GenerateSectionResponse>(url, arg),
  );
}

export function useGenerateExecutiveBriefScoring() {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.scoring,
    (url, { arg }) => postJson<GenerateSectionResponse>(url, arg),
  );
}

export function useGetExecutiveBriefByProject() {
  return useSWRMutation<
    GetExecutiveBriefByProjectResponse,
    Error,
    string,
    GetExecutiveBriefByProjectRequest
  >(endpoints.getByProject, (url, { arg }) => postJson<GetExecutiveBriefByProjectResponse>(url, arg));
}
