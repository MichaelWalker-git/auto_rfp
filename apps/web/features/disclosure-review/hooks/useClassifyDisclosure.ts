'use client';

import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type {
  ClassifyDisclosureRequest,
  ClassifyDisclosureResponse,
} from '@auto-rfp/core';

const BASE_URL = `${env.BASE_API_URL}/pastperf`;

const postJson = async <T,>(url: string, body: unknown): Promise<T> => {
  const res = await authFetcher(url, { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    throw new Error(`Request failed: ${res.status} - ${errorText}`);
  }
  return res.json();
};

/**
 * Trigger the AI classification (backfill) pass. Writes proposals only —
 * the effective disclosure is never changed here.
 */
export const useClassifyDisclosure = () => {
  const { trigger, isMutating, error } = useSWRMutation(
    'classify-disclosure',
    async (_key: string, { arg }: { arg: ClassifyDisclosureRequest }) =>
      postJson<ClassifyDisclosureResponse>(`${BASE_URL}/classify-disclosure`, arg),
  );

  return { trigger, isLoading: isMutating, error };
};
