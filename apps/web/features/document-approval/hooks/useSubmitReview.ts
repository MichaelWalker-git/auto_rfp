'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { SubmitDocumentReview, DocumentApprovalResponse } from '@auto-rfp/core';

export const useSubmitReview = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitReview = async (
    dto: SubmitDocumentReview,
  ): Promise<DocumentApprovalResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiMutate<DocumentApprovalResponse>(
        buildApiUrl('document-approval/review'),
        'POST',
        dto,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit review');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { submitReview, isLoading, error };
};
