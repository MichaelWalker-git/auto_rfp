'use client';

import { useMemo } from 'react';
import { useLaborRates } from '@/lib/hooks/use-pricing';

/**
 * Role typing suggestions drawn from the org's labor-rate positions (BR1.5).
 * Advisory only — free text always stands; no stored linkage (Q1).
 */
export const useRoleSuggestions = (orgId: string | undefined): string[] => {
  const { data } = useLaborRates(orgId);

  return useMemo(() => {
    const positions = (data?.laborRates ?? []).map((rate) => rate.position);
    return Array.from(new Set(positions)).sort((a, b) => a.localeCompare(b));
  }, [data?.laborRates]);
};
