'use client';

import useSWRMutation from 'swr/mutation';
import { mutate } from 'swr';
import { apiMutate, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { EmployeeCreateRequest, EmployeeResponse, EmployeeUpdateRequest } from '@auto-rfp/core';
import { employeesListKey } from './useEmployees';

/** Revalidate the org list after any mutation so the table reflects the change. */
const revalidateList = (orgId: string | undefined) => {
  const key = employeesListKey(orgId);
  if (key) void mutate(key);
};

/** POST /employee/create — create an employee (employee:manage, BR2.2). */
export const useCreateEmployee = (orgId: string | undefined) => {
  const url = orgId ? buildApiUrl('employee/create') : null;

  const { trigger, isMutating, error } = useSWRMutation<
    EmployeeResponse,
    ApiError,
    string | null,
    Omit<EmployeeCreateRequest, 'orgId'>
  >(url, async (mutationUrl, { arg }) => {
    const res = await apiMutate<EmployeeResponse>(mutationUrl, 'POST', { ...arg, orgId });
    revalidateList(orgId);
    return res;
  });

  return { createEmployee: trigger, isCreating: isMutating, error };
};

/** PATCH /employee/update — partial edit; identity immutable (BR3.2). */
export const useUpdateEmployee = (orgId: string | undefined, employeeId: string | undefined) => {
  const url = orgId && employeeId ? buildApiUrl('employee/update', { orgId }) : null;

  const { trigger, isMutating, error } = useSWRMutation<
    EmployeeResponse,
    ApiError,
    string | null,
    EmployeeUpdateRequest
  >(url, async (mutationUrl, { arg }) => {
    const res = await apiMutate<EmployeeResponse>(mutationUrl, 'PATCH', {
      orgId,
      id: employeeId,
      patch: arg,
    });
    revalidateList(orgId);
    if (orgId && employeeId) void mutate(buildApiUrl('employee/get', { orgId, id: employeeId }));
    return res;
  });

  return { updateEmployee: trigger, isUpdating: isMutating, error };
};

/**
 * DELETE /employee/delete — physical removal; never blocked by plan-team
 * references (BR3.1): saved solution-plan teams keep the person's snapshot.
 */
export const useDeleteEmployee = (orgId: string | undefined) => {
  const url = orgId ? buildApiUrl('employee/delete', { orgId }) : null;

  const { trigger, isMutating, error } = useSWRMutation<
    { ok: boolean; id: string },
    ApiError,
    string | null,
    { id: string }
  >(url, async (_mutationUrl, { arg }) => {
    const res = await apiMutate<{ ok: boolean; id: string }>(
      buildApiUrl('employee/delete', { orgId, id: arg.id }),
      'DELETE',
    );
    revalidateList(orgId);
    return res;
  });

  return { deleteEmployee: trigger, isDeleting: isMutating, error };
};
