'use client';

import useSWR from 'swr';
import { useState } from 'react';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  FoiaAutomationItem,
  FoiaAutomationUpdateRequest,
  ConfirmFoiaRecipient,
} from '@auto-rfp/core';

// ─── GET FOIA Automation ──────────────────────────────────────────────────────

interface UseFoiaAutomationResult {
  automation: FoiaAutomationItem | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
  refetch: () => void;
}

export const useFoiaAutomation = (
  orgId: string | null,
  projectId: string | null,
  oppId: string | null
): UseFoiaAutomationResult => {
  const shouldFetch = !!orgId && !!projectId && !!oppId;

  const baseUrl = env.BASE_API_URL.replace(/\/$/, '');

  const { data, error, isLoading, mutate } = useSWR<{ automation: FoiaAutomationItem | null }>(
    shouldFetch
      ? `${baseUrl}/foia/get-foia-automation?orgId=${orgId}&projectId=${projectId}&oppId=${oppId}`
      : null,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch FOIA automation: ${res.status}. ${body}`);
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      dedupingInterval: 30000,
    }
  );

  return {
    automation: data?.automation ?? null,
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
};

// ─── UPDATE FOIA Automation ───────────────────────────────────────────────────

interface UseUpdateFoiaAutomationResult {
  updateFoiaAutomation: (payload: FoiaAutomationUpdateRequest) => Promise<FoiaAutomationItem>;
  isSaving: boolean;
}

export const useUpdateFoiaAutomation = (): UseUpdateFoiaAutomationResult => {
  const [isSaving, setIsSaving] = useState(false);

  const updateFoiaAutomation = async (
    payload: FoiaAutomationUpdateRequest
  ): Promise<FoiaAutomationItem> => {
    setIsSaving(true);
    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
      const url = `${baseUrl}/foia/update-foia-automation`;

      const res = await authFetcher(url, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to update FOIA automation: ${res.status}. ${body}`);
      }

      const result = await res.json();
      return result.automation as FoiaAutomationItem;
    } finally {
      setIsSaving(false);
    }
  };

  return { updateFoiaAutomation, isSaving };
};

// ─── CONFIRM FOIA Recipient ───────────────────────────────────────────────────

interface UseConfirmFoiaRecipientResult {
  confirmRecipient: (payload: ConfirmFoiaRecipient) => Promise<FoiaAutomationItem>;
  isSaving: boolean;
}

export const useConfirmFoiaRecipient = (): UseConfirmFoiaRecipientResult => {
  const [isSaving, setIsSaving] = useState(false);

  const confirmRecipient = async (
    payload: ConfirmFoiaRecipient
  ): Promise<FoiaAutomationItem> => {
    setIsSaving(true);
    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
      const url = `${baseUrl}/foia/confirm-foia-recipient`;

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to confirm FOIA recipient: ${res.status}. ${body}`);
      }

      const result = await res.json();
      return result.automation as FoiaAutomationItem;
    } finally {
      setIsSaving(false);
    }
  };

  return { confirmRecipient, isSaving };
};
