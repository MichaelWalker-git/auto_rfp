'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { DebriefingItem, CreateDebriefingRequest, UpdateDebriefingRequest } from '@auto-rfp/core';

interface UseDebriefingOptions {
  revalidateOnFocus?: boolean;
  refreshInterval?: number;
}

interface UseDebriefingResult {
  debriefings: DebriefingItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
  refetch: () => void;
}

export const useDebriefings = (
  orgId: string | null,
  projectId: string | null,
  opportunityId: string | null,
  options: UseDebriefingOptions = {}
): UseDebriefingResult => {
  const shouldFetch = !!orgId && !!projectId && !!opportunityId;
  const baseUrl = env.BASE_API_URL.replace(/\/$/, '');

  const { data, error, isLoading, mutate } = useSWR<{ debriefings: DebriefingItem[] }>(
    shouldFetch
      ? `${baseUrl}/debriefing/get-debriefing?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}`
      : null,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch debriefings: ${res.status}. ${body}`);
      }
      return res.json();
    },
    {
      revalidateOnFocus: options.revalidateOnFocus ?? false,
      refreshInterval: options.refreshInterval,
      dedupingInterval: 30000,
    }
  );

  return {
    debriefings: data?.debriefings ?? [],
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
};

export const useCreateDebriefing = () => {
  const createDebriefing = async (payload: CreateDebriefingRequest): Promise<DebriefingItem> => {
    const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${baseUrl}/debriefing/create-debriefing`;

    const res = await authFetcher(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to create debriefing: ${res.status}. ${body}`);
    }

    const data = await res.json();
    return data.debriefing as DebriefingItem;
  };

  return { createDebriefing };
};

export const useUpdateDebriefing = () => {
  const updateDebriefing = async (payload: UpdateDebriefingRequest): Promise<DebriefingItem> => {
    const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${baseUrl}/debriefing/update-debriefing`;

    const res = await authFetcher(url, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to update debriefing: ${res.status}. ${body}`);
    }

    const data = await res.json();
    return data.debriefing as DebriefingItem;
  };

  return { updateDebriefing };
};

export const useGenerateDebriefingLetter = () => {
  const generateDebriefingLetter = useCallback(async (
    orgId: string,
    projectId: string,
    opportunityId: string,
    debriefingId: string
  ): Promise<string> => {
    const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${baseUrl}/debriefing/generate-debriefing-letter`;

    const res = await authFetcher(url, {
      method: 'POST',
      body: JSON.stringify({
        orgId,
        projectId,
        opportunityId,
        debriefingId,
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);

      if (body?.missingFields && Array.isArray(body.missingFields)) {
        const fieldLabels: Record<string, string> = {
          requesterName: 'Name',
          requesterTitle: 'Title',
          requesterEmail: 'Email',
          requesterPhone: 'Phone',
          requesterAddress: 'Address',
          companyName: 'Company Name',
          solicitationNumber: 'Solicitation Number',
          contractTitle: 'Contract Title',
          awardNotificationDate: 'Award Notification Date',
          contractingOfficerName: 'Contracting Officer Name',
          contractingOfficerEmail: 'Contracting Officer Email',
        };
        const labels = body.missingFields.map(
          (f: string) => fieldLabels[f] ?? f,
        );
        throw new Error(
          `Please edit the debriefing and fill in: ${labels.join(', ')}`,
        );
      }

      throw new Error(
        body?.message ?? `Failed to generate debriefing letter (${res.status})`,
      );
    }

    const data = await res.json();
    return data.letter as string;
  }, []);

  return { generateDebriefingLetter };
};
