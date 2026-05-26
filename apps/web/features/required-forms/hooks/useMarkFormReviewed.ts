'use client';

import { useCallback } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';

export const useMarkFormReviewed = () => {
  const markReviewed = useCallback(async (args: {
    orgId: string;
    projectId: string;
    opportunityId: string;
    formId: string;
  }) => {
    const url = buildApiUrl(`/required-forms/review/${args.formId}`, {
      orgId: args.orgId,
      projectId: args.projectId,
      opportunityId: args.opportunityId,
    });
    return apiMutate<{ form: unknown }>(url, 'PUT');
  }, []);

  return { markReviewed };
};
