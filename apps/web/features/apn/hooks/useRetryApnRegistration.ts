'use client';

import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RetryApnRegistration } from '@auto-rfp/core';

export const useRetryApnRegistration = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const retry = async (dto: RetryApnRegistration): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiMutate(buildApiUrl('apn/retry-registration'), 'POST', dto);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to retry registration');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { retry, isLoading, error };
};
