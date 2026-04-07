'use client';

import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { ImportDibbsSolicitationRequest } from '@auto-rfp/core';
import type { DuplicateInfo } from '@/lib/hooks/use-import-solicitation';

interface ImportDibbsResponse {
  ok: boolean;
  projectId: string;
  solicitationNumber: string;
  opportunityId: string;
  imported: number;
  /** Present when status is 409 — solicitation already imported */
  duplicate?: DuplicateInfo;
}

export const useDibbsImport = () => {
  const url = `${env.BASE_API_URL}/search-opportunities/import-solicitation`;

  const { trigger, isMutating, error, data } = useSWRMutation<
    ImportDibbsResponse,
    Error,
    string,
    ImportDibbsSolicitationRequest
  >(url, async (u, { arg }) => {
    const res = await authFetcher(u, {
      method: 'POST',
      body: JSON.stringify({ ...arg, source: 'DIBBS' }),
    });

    const raw = await res.text().catch(() => '');
    let parsed: Record<string, unknown> | undefined;
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }

    // Return duplicate info as a successful response so caller can show dialog
    if (res.status === 409 && parsed?.existing) {
      return {
        ok: false,
        projectId: '',
        solicitationNumber: '',
        opportunityId: '',
        imported: 0,
        duplicate: parsed.existing as DuplicateInfo,
      } as ImportDibbsResponse;
    }

    if (!res.ok) {
      throw new Error(
        (parsed?.message as string) || raw || `Import failed: ${res.status}`,
      );
    }

    return (parsed ?? JSON.parse(raw)) as ImportDibbsResponse;
  });

  return {
    importSolicitation: trigger,
    isLoading: isMutating,
    isError: Boolean(error),
    error: error as Error | undefined,
    data,
  };
};