'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { ApnRegistrationResponse } from '@auto-rfp/core';

export const useApnRegistration = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const url =
    orgId && projectId && oppId
      ? buildApiUrl('apn/registration', { orgId, projectId, oppId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<ApnRegistrationResponse>(
    url,
    apiFetcher,
    {
      // Only poll when status is PENDING or RETRYING — stop once settled
      refreshInterval: (data) =>
        data?.registration?.status === 'PENDING' || data?.registration?.status === 'RETRYING'
          ? 10_000
          : 0,
      revalidateOnFocus: false,
    },
  );

  return {
    registration: data?.registration ?? null,
    isLoading,
    error,
    refresh: mutate,
  };
};
