'use client';

import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { breadcrumbs } from '@/lib/sentry';

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
  decision?: 'GO' | 'CONDITIONAL_GO' | 'NO_GO';
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
  brief?: ExecutiveBriefItem;
  message?: string;
  error?: string;
};
export type HandleLinearTicketRequest = {
  executiveBriefId: string;
};

export type HandleLinearTicketResponse = {
  ok: boolean;
  ticket?: {
    id: string;
    identifier: string;
    url: string;
  };
  message?: string;
  error?: string;
};

export type UpdateDecisionRequest = {
  executiveBriefId: string;
  decision: 'GO' | 'NO_GO' | 'CONDITIONAL_GO';
};

export type UpdateDecisionResponse = {
  ok: boolean;
  executiveBriefId?: string;
  decision?: string;
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
  init: (orgId?: string) => `${env.BASE_API_URL}/brief/init-executive-brief${orgId ? `?orgId=${orgId}` : ''}`,
  summary: (orgId?: string) => `${env.BASE_API_URL}/brief/generate-executive-brief-summary${orgId ? `?orgId=${orgId}` : ''}`,
  deadlines: (orgId?: string) => `${env.BASE_API_URL}/brief/generate-executive-brief-deadlines${orgId ? `?orgId=${orgId}` : ''}`,
  contacts: (orgId?: string) => `${env.BASE_API_URL}/brief/generate-executive-brief-contacts${orgId ? `?orgId=${orgId}` : ''}`,
  requirements: (orgId?: string) => `${env.BASE_API_URL}/brief/generate-executive-brief-requirements${orgId ? `?orgId=${orgId}` : ''}`,
  risks: (orgId?: string) => `${env.BASE_API_URL}/brief/generate-executive-brief-risks${orgId ? `?orgId=${orgId}` : ''}`,
  scoring: (orgId?: string) => `${env.BASE_API_URL}/brief/generate-executive-brief-scoring${orgId ? `?orgId=${orgId}` : ''}`,
  getByProject: `${env.BASE_API_URL}/brief/get-executive-brief-by-project`,
  handleLinearTicket: `${env.BASE_API_URL}/brief/handle-linear-ticket`,
  updateDecision: `${env.BASE_API_URL}/brief/update-decision`,
} as const;

// ---------- hooks ----------
export function useInitExecutiveBrief(orgId?: string) {
  return useSWRMutation<InitExecutiveBriefResponse, Error, string, InitExecutiveBriefRequest>(
    endpoints.init(orgId),
    async (url, { arg }) => {
      breadcrumbs.briefGenerationStarted(arg.projectId);
      return postJson<InitExecutiveBriefResponse>(url, arg);
    },
  );
}

export function useGenerateExecutiveBriefSummary(orgId?: string) {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.summary(orgId),
    async (url, { arg }) => {
      const result = await postJson<GenerateSectionResponse>(url, arg);
      breadcrumbs.briefSectionCompleted(arg.executiveBriefId, 'summary');
      return result;
    },
  );
}

export function useGenerateExecutiveBriefDeadlines(orgId?: string) {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.deadlines(orgId),
    async (url, { arg }) => {
      const result = await postJson<GenerateSectionResponse>(url, arg);
      breadcrumbs.briefSectionCompleted(arg.executiveBriefId, 'deadlines');
      return result;
    },
  );
}

export function useGenerateExecutiveBriefContacts(orgId?: string) {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.contacts(orgId),
    async (url, { arg }) => {
      const result = await postJson<GenerateSectionResponse>(url, arg);
      breadcrumbs.briefSectionCompleted(arg.executiveBriefId, 'contacts');
      return result;
    },
  );
}

export function useGenerateExecutiveBriefRequirements(orgId?: string) {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.requirements(orgId),
    async (url, { arg }) => {
      const result = await postJson<GenerateSectionResponse>(url, arg);
      breadcrumbs.briefSectionCompleted(arg.executiveBriefId, 'requirements');
      return result;
    },
  );
}

export function useGenerateExecutiveBriefRisks(orgId?: string) {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.risks(orgId),
    async (url, { arg }) => {
      const result = await postJson<GenerateSectionResponse>(url, arg);
      breadcrumbs.briefSectionCompleted(arg.executiveBriefId, 'risks');
      return result;
    },
  );
}

export function useGenerateExecutiveBriefScoring(orgId?: string) {
  return useSWRMutation<GenerateSectionResponse, Error, string, GenerateSectionRequest>(
    endpoints.scoring(orgId),
    async (url, { arg }) => {
      const result = await postJson<GenerateSectionResponse>(url, arg);
      breadcrumbs.briefSectionCompleted(arg.executiveBriefId, 'scoring');
      return result;
    },
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

export function useHandleLinearTicket() {
  return useSWRMutation<HandleLinearTicketResponse, Error, string, HandleLinearTicketRequest>(
    endpoints.handleLinearTicket,
    (url, { arg }) => postJson<HandleLinearTicketResponse>(url, arg),
  );
}

export function useUpdateDecision() {
  return useSWRMutation<UpdateDecisionResponse, Error, string, UpdateDecisionRequest>(
    endpoints.updateDecision,
    (url, { arg }) => postJson<UpdateDecisionResponse>(url, arg),
  );
}
