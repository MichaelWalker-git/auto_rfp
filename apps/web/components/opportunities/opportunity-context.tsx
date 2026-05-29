'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { OpportunityItem } from '@auto-rfp/core';
import { useOpportunity } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';

interface OpportunityContextValue {
  projectId: string;
  oppId: string;
  orgId: string;
  opportunity: OpportunityItem | null;
  isLoading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

const OpportunityContext = createContext<OpportunityContextValue | null>(null);

export function useOpportunityContext() {
  const ctx = useContext(OpportunityContext);
  if (!ctx) {
    throw new Error('useOpportunityContext must be used within an OpportunityProvider');
  }
  return ctx;
}

interface OpportunityProviderProps {
  projectId: string;
  oppId: string;
  children: React.ReactNode;
}

export function OpportunityProvider({ projectId, oppId, children }: OpportunityProviderProps) {
  const { currentOrganization } = useCurrentOrganization();
  const orgId = currentOrganization?.id || '';

  const { data, isLoading, error, refetch } = useOpportunity(projectId, oppId, orgId || undefined);

  const value = useMemo<OpportunityContextValue>(
    () => ({
      projectId,
      oppId,
      orgId,
      opportunity: (data as OpportunityItem) ?? null,
      isLoading,
      error,
      refetch,
    }),
    [projectId, oppId, orgId, data, isLoading, error, refetch],
  );

  return (
    <OpportunityContext.Provider value={value}>
      {children}
    </OpportunityContext.Provider>
  );
}