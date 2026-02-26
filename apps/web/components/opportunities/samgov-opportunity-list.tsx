'use client';

/**
 * SamGovOpportunityList — now uses the common SearchOpportunityResultsTable.
 * Maps SamOpportunitySlim → SearchOpportunitySlim via samSlimToSearchOpportunity.
 */
import * as React from 'react';
import { useState } from 'react';

import type { SamOpportunitySlim } from '@auto-rfp/core';
import { samSlimToSearchOpportunity } from '@auto-rfp/core';
import { PaginationControls } from './pagination-controls';
import { EmptyState } from './empty-state';
import { LoadingState } from './loading-state';
import { SearchOpportunityResultsTable } from './SearchOpportunityResultsTable';
import { useCurrentOrganization } from '@/context/organization-context';

type Props = {
  data?: {
    opportunities: SamOpportunitySlim[];
    totalRecords: number;
    limit: number;
    offset: number;
  } | null;
  isLoading: boolean;
  onPage: (offset: number) => Promise<void>;
  onImportSolicitation: (data: SamOpportunitySlim) => void;
};

export function SamGovOpportunityList({ data, isLoading, onPage, onImportSolicitation }: Props) {
  const results = data?.opportunities ?? [];
  const offset  = data?.offset ?? 0;
  const limit   = data?.limit  ?? 25;
  const total   = data?.totalRecords ?? 0;
  const [importingId, setImportingId] = useState<string | null>(null);
  const { currentOrganization } = useCurrentOrganization();

  // Map raw SAM.gov slim records to the unified SearchOpportunitySlim shape
  const unified = results.map(samSlimToSearchOpportunity);

  const handleImport = async (id: string) => {
    // Find the original SamOpportunitySlim by noticeId or solicitationNumber
    const original = results.find(
      (o) => (o.noticeId ?? o.solicitationNumber) === id,
    );
    if (!original) return;
    setImportingId(id);
    try {
      await onImportSolicitation(original);
    } finally {
      setImportingId(null);
    }
  };

  return (
    <div className="space-y-3">
      {isLoading && !data && <LoadingState />}
      {data && results.length === 0 && <EmptyState />}

      <SearchOpportunityResultsTable
        opportunities={unified}
        isLoading={isLoading && !data}
        onImport={handleImport}
        importingId={importingId}
        orgId={currentOrganization?.id}
      />

      <PaginationControls
        offset={offset}
        limit={limit}
        total={total}
        isLoading={isLoading}
        onPage={onPage}
      />
    </div>
  );
}
