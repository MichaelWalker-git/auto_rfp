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
    { refreshInterval: 10_000 }, // poll every 10s while PENDING/RETRYING
  );

  return {
    registration: data?.registration ?? null,
    isLoading,
    error,
    refresh: mutate,
  };
};
