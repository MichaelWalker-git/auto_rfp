'use client';

import useSWR from 'swr';
import { useCallback, useState } from 'react';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { BedrockConfigStatusResponse } from '@auto-rfp/core';

/**
 * Outcome of a save attempt. `ok: false` with `missingModels` is the expected
 * probe-rejection path (HTTP 422) — NOT an error to throw; the card renders it.
 */
export interface BedrockSaveResult {
  ok: boolean;
  missingModels?: string[];
  message?: string;
}

interface UseBedrockConfigResult {
  status: BedrockConfigStatusResponse | undefined;
  isLoading: boolean;
  mutate: () => void;
  /** Save or (empty apiKey) clear the config. Never throws on a probe rejection. */
  saveConfig: (args: { apiKey: string; fallbackModelId?: string }) => Promise<BedrockSaveResult>;
  isSaving: boolean;
}

/**
 * get/set logic + SWR revalidation for the per-org Bedrock configuration.
 * Keeps all API access out of the presentational card.
 */
export const useBedrockConfig = (orgId: string): UseBedrockConfigResult => {
  const [isSaving, setIsSaving] = useState(false);

  const getUrl = orgId
    ? `${env.BASE_API_URL}/bedrock/get-config?orgId=${encodeURIComponent(orgId)}`
    : null;

  const { data, isLoading, mutate } = useSWR<BedrockConfigStatusResponse>(
    getUrl,
    async (u: string) => {
      const res = await authFetcher(u);
      if (!res.ok) return { configured: false };
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  const saveConfig = useCallback(
    async ({ apiKey, fallbackModelId }: { apiKey: string; fallbackModelId?: string }): Promise<BedrockSaveResult> => {
      setIsSaving(true);
      try {
        const res = await authFetcher(`${env.BASE_API_URL}/bedrock/set-config`, {
          method: 'POST',
          body: JSON.stringify({ orgId, apiKey, fallbackModelId }),
        });

        const body = await res.json().catch(() => ({}));

        // 422 = probe rejection: surface the missing models, don't throw.
        if (res.status === 422) {
          return { ok: false, missingModels: body.missingModels ?? [], message: body.message };
        }
        if (!res.ok) {
          throw new Error(body.message ?? `Failed to save Bedrock config: ${res.status}`);
        }

        mutate();
        return { ok: true };
      } finally {
        setIsSaving(false);
      }
    },
    [orgId, mutate],
  );

  return { status: data, isLoading, mutate, saveConfig, isSaving };
};
