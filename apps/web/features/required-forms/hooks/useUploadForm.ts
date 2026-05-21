'use client';

import { useCallback } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RequiredFormItem } from '@auto-rfp/core';

export const useUploadForm = () => {
  const uploadForm = useCallback(async (args: {
    orgId: string;
    projectId: string;
    opportunityId: string;
    name: string;
    formType: string;
    sourceFileName: string;
    sourceFileKey: string;
  }) => {
    const url = buildApiUrl('/required-forms/upload', { orgId: args.orgId });
    return apiMutate<{ form: RequiredFormItem; formId: string }>(url, 'POST', {
      projectId: args.projectId,
      opportunityId: args.opportunityId,
      name: args.name,
      formType: args.formType,
      sourceFileName: args.sourceFileName,
      sourceFileKey: args.sourceFileKey,
    });
  }, []);

  return { uploadForm };
};
