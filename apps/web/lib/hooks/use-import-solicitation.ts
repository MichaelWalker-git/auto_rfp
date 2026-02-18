'use client';

import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { ImportSolicitationRequest } from '@auto-rfp/core';

export type ImportSolicitationResponse = {
  ok: boolean;
  noticeId: string;
  projectId: string;
  imported: number;
  files?: Array<{
    questionFileId: string;
    fileKey: string;
    originalFileName?: string;
    executionArn?: string;
    url: string;
  }>;
  message?: string;
  error?: string;
};

export function useImportSolicitation() {
  return useSWRMutation<
    ImportSolicitationResponse,
    any,
    string,
    ImportSolicitationRequest
  >(`${env.BASE_API_URL}/samgov/import-solicitation`, async (url, { arg }) => {
    const res = await authFetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(arg),
    });

    if (!res.ok) {
      const message = await res.text().catch(() => '');
      const error = new Error(message || 'Failed to import solicitation') as Error & {
        status?: number;
      };
      (error as any).status = res.status;
      throw error;
    }

    const raw = await res.text().catch(() => '');
    if (!raw) throw new Error('Empty response from import-solicitation');

    try {
      return JSON.parse(raw) as ImportSolicitationResponse;
    } catch {
      throw new Error('Invalid JSON response from import-solicitation');
    }
  });
}
