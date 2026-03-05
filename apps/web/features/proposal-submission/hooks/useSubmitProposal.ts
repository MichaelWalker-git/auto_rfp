'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { SubmitProposal, SubmitProposalResponse } from '@auto-rfp/core';

export const useSubmitProposal = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (dto: SubmitProposal): Promise<SubmitProposalResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiMutate<SubmitProposalResponse>(
        buildApiUrl('proposal-submission/submit'),
        'POST',
        dto,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit proposal');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { submit, isLoading, error };
};
