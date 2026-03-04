'use client';

import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { SaveApnCredentials } from '@auto-rfp/core';

export const useSaveApnCredentials = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (dto: SaveApnCredentials): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      await apiMutate(buildApiUrl('apn/credentials'), 'POST', dto);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return { save, isLoading, error };
};
