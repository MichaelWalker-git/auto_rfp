'use client';

import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { ConfirmDisclosureRequest } from '@auto-rfp/core';

const BASE_URL = `${env.BASE_API_URL}/pastperf`;

interface ConfirmDisclosureResponse {
  confirmed: number;
}

const postJson = async <T,>(url: string, body: unknown): Promise<T> => {
  const res = await authFetcher(url, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Request failed: ${res.status} - ${errorText}`);
  }
  return res.json();
};

/**
 * Batch human confirm/override — the only path that flips a row to "trusted".
 */
export const useConfirmDisclosure = () => {
  const { trigger, isMutating, error } = useSWRMutation(
    'confirm-disclosure',
    async (_key: string, { arg }: { arg: ConfirmDisclosureRequest }) =>
      postJson<ConfirmDisclosureResponse>(`${BASE_URL}/confirm-disclosure`, arg),
  );

  return { trigger, isLoading: isMutating, error };
};
