'use client';

import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

interface ExportProposalRequest {
  projectId: string;
  proposalId: string;
  opportunityId: string;
}

interface ExportProposalResponse {
  success: boolean;
  proposal: {
    id: string;
    title: string;
  };
  export: {
    format: string;
    bucket: string;
    key: string;
    url: string;
    expiresIn: number;
  };
}

const BASE = `${env.BASE_API_URL}/export`;

export function useExportProposal() {
  return useSWRMutation<ExportProposalResponse, any, string, ExportProposalRequest>(
    `${BASE}/generate-word`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(message || 'Failed to export proposal') as Error & {
          status?: number;
        };
        error.status = res.status;
        throw error;
      }

      const json = await res.json().catch(() => {
        throw new Error('Invalid JSON returned from API');
      });

      if (!json.success) {
        throw new Error(json.message || 'Failed to export proposal');
      }

      return json;
    },
  );
}