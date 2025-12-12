'use client';

import useSWRMutation from 'swr/mutation';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

export type ProposalSubsection = {
  id: string;
  title: string;
  content: string;
};

export type ProposalSection = {
  id: string;
  title: string;
  summary?: string | null;
  subsections: ProposalSubsection[];
};

export type ProposalDocument = {
  proposalTitle: string;
  customerName?: string | null;
  opportunityId?: string | null;
  outlineSummary?: string | null;
  sections: ProposalSection[];
};

const BASE = `${env.BASE_API_URL}/proposal`;

type GenerateProposalArgs = {
  projectId: string;
};

export function useGenerateProposal() {
  return useSWRMutation<
    ProposalDocument,
    any,
    string,
    GenerateProposalArgs
  >(
    `${BASE}/generate-proposal`,
    async (url, { arg }) => {
      const { projectId } = arg;

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(
          message || 'Failed to generate proposal',
        ) as Error & { status?: number };
        (error as any).status = res.status;
        throw error;
      }

      const raw = await res.text();

      try {
        return JSON.parse(raw) as ProposalDocument;
      } catch {
        // If backend returns non-JSON for some reason
        throw new Error('Invalid proposal JSON returned from API');
      }
    },
  );
}
