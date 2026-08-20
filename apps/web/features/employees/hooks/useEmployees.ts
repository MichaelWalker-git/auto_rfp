'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { EmployeeItem, ListEmployeesResponse } from '@auto-rfp/core';

/** SWR key for the org employee list — shared with the mutation hooks. */
export const employeesListKey = (orgId: string | undefined): string | null =>
  orgId ? buildApiUrl('employee/list', { orgId }) : null;

/**
 * GET /employee/list — the organization's employee pool (BR2.3 org-scoped).
 * Search/filter/sort/pagination are applied client-side on this set (BR4.1).
 */
export const useEmployees = (orgId: string | undefined) => {
  const { data, error, isLoading, mutate } = useSWR<ListEmployeesResponse, ApiError>(
    employeesListKey(orgId),
    apiFetcher,
    { revalidateOnFocus: false },
  );

  const employees: EmployeeItem[] = data?.items ?? [];

  return {
    employees,
    count: data?.count ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
};
