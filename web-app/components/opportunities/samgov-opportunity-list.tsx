'use client';

import * as React from 'react';
import { useState } from 'react';

import type { SamOpportunitySlim } from '@auto-rfp/shared';
import { useSamGovDescription, type SamGovDescriptionResponse } from '@/lib/hooks/use-opportunities';
import { useToast } from '../ui/use-toast';
import { DescriptionDialog } from './description-dialog';
import { PaginationControls } from './pagination-controls';
import { EmptyState } from './empty-state';
import { LoadingState } from './loading-state';
import { SamGovOpportunityCard } from '@/components/opportunities/samgov-opportunity-card';

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
  const offset = data?.offset ?? 0;
  const limit = data?.limit ?? 25;
  const total = data?.totalRecords ?? 0;

  const [selectedDescription, setSelectedDescription] = useState<SamGovDescriptionResponse | null>(null);
  const [selectedOpportunity, setSelectedOpportunity] = useState<SamOpportunitySlim | null>(null);

  const { trigger: fetchDescription, isMutating } = useSamGovDescription();
  const { toast } = useToast();

  const handleViewDescription = async (opportunity: SamOpportunitySlim) => {
    if (!opportunity) {
      console.error('Opportunity is null');
      toast({
        title: 'Error',
        description: 'Invalid opportunity data.',
        variant: 'destructive',
      });
      return;
    }
    setSelectedOpportunity(opportunity);
    if (!opportunity.description) {
      console.error('No description URL available');
      toast({
        title: 'No description available',
        description: 'No description is available for this opportunity.',
        variant: 'destructive',
      });
      setSelectedOpportunity(null);
      return;
    }

    try {
      const descriptionData = await fetchDescription({ descriptionUrl: opportunity.description });
      setSelectedDescription(descriptionData);
    } catch (error) {
      console.error('Failed to load description:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch opportunity description',
        variant: 'destructive',
      });
    }
  };

  const handleCloseDialog = () => {
    setSelectedDescription(null);
    setSelectedOpportunity(null);
  };

  return (
    <div className="space-y-3">
      {isLoading && !data && <LoadingState />}

      {data && results.length === 0 && <EmptyState />}

      {results.map((opportunity) => (
        <SamGovOpportunityCard
          key={opportunity.noticeId ?? `${opportunity.solicitationNumber}-${opportunity.postedDate}-${opportunity.title}`}
          opportunity={opportunity}
          isLoadingDescription={isMutating && opportunity.solicitationNumber === selectedOpportunity?.solicitationNumber}
          onViewDescription={handleViewDescription}
          onImportSolicitation={onImportSolicitation}
          isImporting={isLoading}
        />
      ))}

      <DescriptionDialog
        isOpen={!!selectedDescription}
        title={selectedOpportunity?.title ?? ''}
        description={selectedDescription}
        isLoading={isMutating}
        onOpenChange={handleCloseDialog}
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