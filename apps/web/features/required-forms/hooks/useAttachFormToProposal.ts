'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RequiredFormItem } from '@auto-rfp/core';

interface AttachArgs {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
}

/**
 * Hook for attaching / detaching a required form to the RFP proposal package.
 * After mutation, revalidates the required-forms list and the rfp-document
 * list so both UIs reflect the change immediately.
 */
export const useAttachFormToProposal = () => {
  const { mutate } = useSWRConfig();

  const attach = useCallback(
    async ({ orgId, projectId, opportunityId, formId }: AttachArgs) => {
      const url = buildApiUrl('/required-forms/attach', { orgId, projectId, opportunityId });
      const result = await apiMutate<{ form: RequiredFormItem }, AttachArgs>(url, 'POST', {
        orgId, projectId, opportunityId, formId,
      });
      mutate(
        (key: unknown) =>
          typeof key === 'string' &&
          (key.includes('/required-forms/list') || key.includes('/rfp-document/')),
      );
      return result.form;
    },
    [mutate],
  );

  const detach = useCallback(
    async ({ orgId, projectId, opportunityId, formId }: AttachArgs) => {
      const url = buildApiUrl('/required-forms/attach', {
        orgId, projectId, opportunityId, formId,
      });
      const result = await apiMutate<{ form: RequiredFormItem }>(url, 'DELETE');
      mutate(
        (key: unknown) =>
          typeof key === 'string' &&
          (key.includes('/required-forms/list') || key.includes('/rfp-document/')),
      );
      return result.form;
    },
    [mutate],
  );

  return { attach, detach };
};
