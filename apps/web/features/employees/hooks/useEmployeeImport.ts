'use client';

import { useEffect, useRef } from 'react';
import useSWR, { mutate } from 'swr';
import useSWRMutation from 'swr/mutation';
import { apiFetcher, apiMutate, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type {
  EmployeeImportRunItem,
  EmployeeImportRunResponse,
  TriggerEmployeeImportResponse,
} from '@auto-rfp/core';
import { employeesListKey } from './useEmployees';

/** SWR key for the org's latest import run. */
export const employeeImportLatestKey = (orgId: string | undefined): string | null =>
  orgId ? buildApiUrl('employee/import/latest', { orgId }) : null;

/** Poll cadence while a run is RUNNING (BR5.1 observable progress). */
const RUNNING_POLL_INTERVAL_MS = 3000;

/**
 * Generate-from-CVs import flow (U2, W1/W2):
 * - `triggerImport` — POST /employee/import/trigger (employee:manage; a 409
 *   means a run is already RUNNING — BR1.1).
 * - Polls GET /employee/import/latest while the run is RUNNING and stops on
 *   completion; the page stays usable throughout (BR5.1).
 * - Revalidates the employee list when a run reaches a terminal state so the
 *   table shows the imported people (W1 step 6).
 */
export const useEmployeeImport = (orgId: string | undefined) => {
  const {
    data,
    error,
    isLoading,
    mutate: refreshRun,
  } = useSWR<EmployeeImportRunResponse, ApiError>(employeeImportLatestKey(orgId), apiFetcher, {
    revalidateOnFocus: false,
    refreshInterval: (latest) =>
      latest?.run?.status === 'RUNNING' ? RUNNING_POLL_INTERVAL_MS : 0,
  });

  const run: EmployeeImportRunItem | null = data?.run ?? null;
  const isRunning = run?.status === 'RUNNING';

  // Refresh the employee list once, when the run transitions out of RUNNING.
  const previousStatusRef = useRef<EmployeeImportRunItem['status'] | undefined>(undefined);
  useEffect(() => {
    const status = run?.status;
    if (previousStatusRef.current === 'RUNNING' && status && status !== 'RUNNING') {
      const listKey = employeesListKey(orgId);
      if (listKey) void mutate(listKey);
    }
    previousStatusRef.current = status;
  }, [run?.status, orgId]);

  const triggerUrl = orgId ? buildApiUrl('employee/import/trigger') : null;
  const {
    trigger: triggerImport,
    isMutating: isTriggering,
    error: triggerError,
  } = useSWRMutation<TriggerEmployeeImportResponse, ApiError, string | null>(
    triggerUrl,
    async (mutationUrl) => {
      const res = await apiMutate<TriggerEmployeeImportResponse>(mutationUrl, 'POST', { orgId });
      await refreshRun();
      return res;
    },
  );

  return {
    /** The latest run for the org, or null when never imported. */
    run,
    isRunning,
    isLoading,
    error,
    triggerImport,
    isTriggering,
    triggerError,
    refreshRun,
  };
};
