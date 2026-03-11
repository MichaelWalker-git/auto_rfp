'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { ResubmitForReview, DocumentApprovalResponse } from '@auto-rfp/core';

export const useResubmitForReview = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resubmit = async (
    dto: ResubmitForReview,
  ): Promise<DocumentApprovalResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiMutate<DocumentApprovalResponse>(
        buildApiUrl('document-approval/resubmit'),
        'POST',
        dto,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-submit for review');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { resubmit, isLoading, error };
};
