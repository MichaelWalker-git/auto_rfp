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
  /** Present when status is 409 — solicitation already imported */
  duplicate?: DuplicateInfo;
};

export type DuplicateInfo = {
  oppId: string;
  projectId: string;
  projectName?: string | null;
  title: string;
  noticeId?: string;
  solicitationNumber?: string;
  importedBy?: string | null;
  importedAt?: string;
};

export type ImportSolicitationError = Error & {
  status?: number;
  duplicate?: DuplicateInfo;
};

export function useImportSolicitation() {
  return useSWRMutation<
    ImportSolicitationResponse,
    Error,
    string,
    ImportSolicitationRequest
  >(`${env.BASE_API_URL}/search-opportunities/import-solicitation`, async (url, { arg }) => {
    const res = await authFetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...arg, source: 'SAM_GOV' }),
    });

    const raw = await res.text().catch(() => '');
    let parsed: Record<string, unknown> | undefined;
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }

    // Return duplicate info as a successful response so caller can show dialog
    if (res.status === 409 && parsed?.existing) {
      return {
        ok: false,
        noticeId: '',
        projectId: '',
        imported: 0,
        duplicate: parsed.existing as DuplicateInfo,
        message: (parsed.message as string) ?? 'Already imported',
      } as ImportSolicitationResponse;
    }

    if (!res.ok) {
      throw new Error(
        (parsed?.message as string) || raw || 'Failed to import solicitation',
      );
    }

    if (!raw) throw new Error('Empty response from import-solicitation');

    return (parsed ?? JSON.parse(raw)) as ImportSolicitationResponse;
  });
}