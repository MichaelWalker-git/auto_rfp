'use client';

/**
 * DibbsResultsTable — thin wrapper that maps DibbsOpportunitySlim → SearchOpportunitySlim
 * and delegates rendering to the shared SearchOpportunityResultsTable.
 */
import type { DibbsOpportunitySlim } from '@auto-rfp/core';
import { dibbsSlimToSearchOpportunity } from '@auto-rfp/core';
import { SearchOpportunityResultsTable } from '@/components/opportunities/SearchOpportunityResultsTable';

interface DibbsResultsTableProps {
  opportunities: DibbsOpportunitySlim[];
  isLoading: boolean;
  onImport: (solicitationNumber: string) => void;
  importingId: string | null;
}

export const DibbsResultsTable = ({
  opportunities,
  isLoading,
  onImport,
  importingId,
}: DibbsResultsTableProps) => {
  const unified = opportunities.map(dibbsSlimToSearchOpportunity);

  return (
    <SearchOpportunityResultsTable
      opportunities={unified}
      isLoading={isLoading}
      onImport={onImport}
      importingId={importingId}
    />
  );
};
