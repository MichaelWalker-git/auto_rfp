'use client';

import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { ImportDibbsSolicitationRequest } from '@auto-rfp/core';

interface ImportDibbsResponse {
  ok: boolean;
  projectId: string;
  solicitationNumber: string;
  opportunityId: string;
  imported: number;
}

export const useDibbsImport = () => {
  const url = `${env.BASE_API_URL}/search-opportunities/dibbs/import-solicitation`;

  const { trigger, isMutating, error, data } = useSWRMutation<
    ImportDibbsResponse,
    Error,
    string,
    ImportDibbsSolicitationRequest
  >(url, async (u, { arg }) => {
    const res = await authFetcher(u, {
      method: 'POST',
      body: JSON.stringify(arg),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `Import failed: ${res.status}`);
    }
    return res.json() as Promise<ImportDibbsResponse>;
  });

  return {
    importSolicitation: trigger,
    isLoading: isMutating,
    isError: Boolean(error),
    error: error as Error | undefined,
    data,
  };
};
