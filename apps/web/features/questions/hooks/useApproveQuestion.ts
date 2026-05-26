'use client';

import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';

import type { ApproveQuestionDTO, QuestionItem } from '@auto-rfp/core';

/**
 * Mutation hook that POSTs to /question/approve. Mirrors the pattern used by
 * useMarkFormReviewed / useAttachFormToProposal — revalidates anything keyed
 * on questions or question files so a freshly approved question reflects in
 * the surrounding lists immediately.
 */
export const useApproveQuestion = () => {
  const { mutate } = useSWRConfig();
  const [isApproving, setIsApproving] = useState(false);

  const approve = useCallback(async (dto: ApproveQuestionDTO): Promise<QuestionItem> => {
    setIsApproving(true);
    try {
      const url = buildApiUrl('/question/approve', { orgId: dto.orgId });
      const result = await apiMutate<{ question: QuestionItem }, ApproveQuestionDTO>(url, 'POST', dto);
      mutate(
        (key: unknown) =>
          typeof key === 'string' &&
          (key.includes('/questionfile/') || key.includes('/question/') || key.includes('/project/get-questions')),
      );
      return result.question;
    } finally {
      setIsApproving(false);
    }
  }, [mutate]);

  return { approve, isApproving };
};
