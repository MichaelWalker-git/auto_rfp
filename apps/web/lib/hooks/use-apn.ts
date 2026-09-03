import { ApiError, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import useSWRMutation from 'swr/mutation';
import type { SyncToApnRequest } from '@auto-rfp/core';

export interface SyncApnResponse {
  ok: boolean;
  apnOpportunityId: string | null;
  apnSyncError: string | null;
}

export function useSyncApn() {
  return useSWRMutation<SyncApnResponse, ApiError, string, SyncToApnRequest>(
    buildApiUrl('apn/sync'),
    async (url, { arg }) => {
      return await apiMutate<SyncApnResponse, SyncToApnRequest>(url, 'POST', arg);
    },
  );
}
