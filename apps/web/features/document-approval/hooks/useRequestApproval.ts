'use client';
import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RequestDocumentApproval, DocumentApprovalResponse } from '@auto-rfp/core';

export const useRequestApproval = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestApproval = async (
    dto: RequestDocumentApproval,
  ): Promise<DocumentApprovalResponse | null> => {
    setIsLoading(true);
    setError(null);
    try {
      return await apiMutate<DocumentApprovalResponse>(
        buildApiUrl('document-approval/request'),
        'POST',
        dto,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request approval');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return { requestApproval, isLoading, error };
};
