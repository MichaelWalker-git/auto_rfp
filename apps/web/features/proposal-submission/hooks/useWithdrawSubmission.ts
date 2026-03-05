'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { WithdrawSubmission } from '@auto-rfp/core';

export const useWithdrawSubmission = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withdraw = async (dto: WithdrawSubmission): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiMutate(buildApiUrl('proposal-submission/withdraw'), 'POST', dto);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to withdraw submission');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { withdraw, isLoading, error };
};
