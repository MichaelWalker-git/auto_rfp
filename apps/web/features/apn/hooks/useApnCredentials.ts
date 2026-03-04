'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { GetApnCredentialsResponse } from '@auto-rfp/core';

export const useApnCredentials = (orgId: string | undefined) => {
  const url = orgId ? buildApiUrl('apn/credentials', { orgId }) : null;

  const { data, error, isLoading, mutate } = useSWR<GetApnCredentialsResponse>(
    url,
    apiFetcher,
  );

  return {
    credentials: data,
    isConfigured: data?.configured ?? false,
    isLoading,
    error,
    refresh: mutate,
  };
};
