'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { EmployeeItem, EmployeeResponse } from '@auto-rfp/core';

/**
 * GET /employee/get — one employee within the org scope. A 404 (missing or
 * cross-org record, BR2.3) surfaces as `notFound`, not a generic error.
 */
export const useEmployee = (orgId: string | undefined, employeeId: string | undefined) => {
  const url =
    orgId && employeeId ? buildApiUrl('employee/get', { orgId, id: employeeId }) : null;

  const { data, error, isLoading, mutate } = useSWR<EmployeeResponse, ApiError>(
    url,
    apiFetcher,
    { revalidateOnFocus: false },
  );

  const notFound = error?.status === 404;
  const employee: EmployeeItem | null = data?.item ?? null;

  return {
    employee,
    isLoading,
    notFound,
    error: notFound ? undefined : error,
    refresh: mutate,
  };
};
