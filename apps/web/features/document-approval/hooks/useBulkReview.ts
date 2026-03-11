'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { BulkSubmitDocumentReview, BulkReviewResponse } from '@auto-rfp/core';

export const useBulkReview = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bulkReview = async (
    dto: BulkSubmitDocumentReview,
  ): Promise<BulkReviewResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiMutate<BulkReviewResponse>(
        buildApiUrl('document-approval/bulk-review'),
        'POST',
        dto,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit bulk review');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { bulkReview, isLoading, error };
};
