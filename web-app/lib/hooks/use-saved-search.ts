'use client';

import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { CreateSavedSearchRequest, SavedSearch, } from '@auto-rfp/shared';

export function useCreateSavedSearch() {
  return useSWRMutation<
    SavedSearch,
    any,
    string,
    CreateSavedSearchRequest
  >(
    `${env.BASE_API_URL}/samgov/create-saved-search`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(message || 'Failed to create saved search') as Error & {
          status?: number;
        };
        (error as any).status = res.status;
        throw error;
      }

      const raw = await res.text().catch(() => '');
      if (!raw) throw new Error('Empty response from create-saved-search');

      try {
        return JSON.parse(raw) as SavedSearch;
      } catch {
        throw new Error('Invalid JSON response from create-saved-search');
      }
    },
  );
}
