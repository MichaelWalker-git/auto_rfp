'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { ApnRegistrationsListResponse } from '@auto-rfp/core';

export const useApnRegistrations = (orgId: string | undefined) => {
  const url = orgId ? buildApiUrl('apn/registrations', { orgId }) : null;

  const { data, error, isLoading, mutate } = useSWR<ApnRegistrationsListResponse>(
    url,
    apiFetcher,
    { revalidateOnFocus: false },
  );

  return {
    registrations: data?.items ?? [],
    count: data?.count ?? 0,
    isLoading,
    isError: !!error,
    refresh: mutate,
  };
};
