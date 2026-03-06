'use client';

import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import { SaveApnCredentialsSchema } from '@auto-rfp/core';
import type { z } from 'zod';

type SaveApnCredentialsInput = z.input<typeof SaveApnCredentialsSchema>;

export const useSaveApnCredentials = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (dto: SaveApnCredentialsInput): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    try {
      // Parse through Zod to apply defaults (e.g., region)
      const parsed = SaveApnCredentialsSchema.parse(dto);
      await apiMutate(buildApiUrl('apn/credentials'), 'POST', parsed);
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
