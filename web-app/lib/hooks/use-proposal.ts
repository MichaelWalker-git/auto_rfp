'use client';

import useSWRMutation from 'swr/mutation';

import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { useApi } from '@/lib/hooks/use-api';

import {
  GenerateProposalInput,
  GenerateProposalInputSchema,
  type Proposal,
  type ProposalDocument,
  ProposalDocumentSchema,
  type ProposalListResponse,
  ProposalListResponseSchema,
  ProposalSchema,
  ProposalStatus,
  type SaveProposalRequest,
  SaveProposalRequestSchema,
} from '@auto-rfp/shared';

const BASE = `${env.BASE_API_URL}/proposal`;

// --------------------
// Generate Proposal (returns ProposalDocument)
// --------------------

export function useGenerateProposal() {
  return useSWRMutation<ProposalDocument, any, string, GenerateProposalInput>(
    `${BASE}/generate-proposal`,
    async (url, { arg }) => {
      const parsedArgs = GenerateProposalInputSchema.safeParse(arg);
      if (!parsedArgs.success) {
        throw new Error(
          parsedArgs.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
        );
      }

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify({ projectId: parsedArgs.data.projectId }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(message || 'Failed to generate proposal') as Error & {
          status?: number;
        };
        error.status = res.status;
        throw error;
      }

      const json = await res.json().catch(() => {
        throw new Error('Invalid JSON returned from API');
      });

      const parsed = ProposalDocumentSchema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`API returned invalid ProposalDocument: ${issues}`);
      }

      return parsed.data;
    },
  );
}

export function useProposals(params: { projectId?: string | null; includeDocument?: boolean }) {
  const { projectId } = params;

  const qs = new URLSearchParams();
  if (projectId) qs.set('projectId', projectId);

  const url = projectId ? `${BASE}/get-proposals?${qs.toString()}` : null;
  const swrKey = projectId ? ['proposals', projectId] : null;

  const { data, error, isLoading, mutate } = useApi<ProposalListResponse>(swrKey as any, url);

  const parsed = data ? ProposalListResponseSchema.safeParse(data) : null;

  return {
    items: parsed?.success ? parsed.data.items : (data?.items ?? []),
    count: parsed?.success ? parsed.data.count : (data?.count ?? 0),
    error: error ?? (parsed && !parsed.success ? parsed.error : null),
    isLoading,
    refresh: mutate,
  };
}

// --------------------
// Save Proposal (takes SaveProposalRequest, returns Proposal entity)
// --------------------

export type SaveProposalArgs = SaveProposalRequest;

export function useSaveProposal() {
  return useSWRMutation<Proposal, any, string, SaveProposalArgs>(
    `${BASE}/save-proposal`,
    async (url, { arg }) => {
      const parsedArgs = SaveProposalRequestSchema.safeParse(arg);
      if (!parsedArgs.success) {
        throw new Error(
          parsedArgs.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '),
        );
      }

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(parsedArgs.data),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(message || 'Failed to save proposal') as Error & {
          status?: number;
        };
        error.status = res.status;
        throw error;
      }

      const json = await res.json().catch(() => {
        throw new Error('Invalid JSON returned from API');
      });

      const parsed = ProposalSchema.safeParse(json);
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
        throw new Error(`API returned invalid Proposal entity: ${issues}`);
      }

      return parsed.data;
    },
  );
}

// --------------------
// Convenience: generate -> save (no mappers in UI)
// --------------------

export function buildSaveRequest(params: {
  projectId: string;
  organizationId?: string | null;
  document: ProposalDocument;
  status?: ProposalStatus;
  title?: string | null;
  id?: string | null;
}): SaveProposalRequest {
  return SaveProposalRequestSchema.parse({
    id: params.id ?? undefined,
    projectId: params.projectId,
    organizationId: params.organizationId ?? null,
    status: params.status ?? ProposalStatus.NEW,
    title: params.title ?? params.document.proposalTitle ?? null,
    document: params.document,
  });
}

export function useProposal(params: { projectId?: string | null; proposalId?: string | null }) {
  const { projectId, proposalId } = params;

  const qs = new URLSearchParams();
  if (projectId) qs.set('projectId', projectId);
  if (proposalId) qs.set('proposalId', proposalId);

  const url =
    projectId && proposalId
      ? `${BASE}/get-proposal?projectId=${encodeURIComponent(projectId)}&proposalId=${encodeURIComponent(proposalId)}`
      : null;

  const swrKey = projectId && proposalId ? ['proposal', projectId, proposalId] : null;

  const { data, error, isLoading, mutate } = useApi<Proposal>(swrKey, url);

  return {
    item: data,
    isLoading,
    error,
    refresh: mutate,
  };
}