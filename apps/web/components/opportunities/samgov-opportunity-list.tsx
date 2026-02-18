'use client';

import * as React from 'react';
import { useState } from 'react';

import type { SamOpportunitySlim } from '@auto-rfp/core';
import { type SamGovDescriptionResponse, useSamGovDescription } from '@/lib/hooks/use-opportunities';
import { useToast } from '../ui/use-toast';
import { PaginationControls } from './pagination-controls';
import { EmptyState } from './empty-state';
import { LoadingState } from './loading-state';
import { SamGovOpportunityCard } from '@/components/opportunities/samgov-opportunity-card';
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
  const offset = data?.offset ?? 0;
  const limit = data?.limit ?? 25;
  const total = data?.totalRecords ?? 0;

  const [descriptions, setDescriptions] = useState<Map<string, SamGovDescriptionResponse>>(new Map());
  const [loadingOpportunity, setLoadingOpportunity] = useState<string | null>(null);
  const { currentOrganization } = useCurrentOrganization();
  const { trigger: fetchDescription } = useSamGovDescription(currentOrganization?.id);
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

    const opportunityKey = opportunity.noticeId ?? opportunity.solicitationNumber ?? '';
    
    // If already loaded, just toggle (handled by card component)
    if (descriptions.has(opportunityKey)) {
      return;
    }

    if (!opportunity.description) {
      console.error('No description URL available');
      toast({
        title: 'No description available',
        description: 'No description is available for this opportunity.',
        variant: 'destructive',
      });
      return;
    }

    setLoadingOpportunity(opportunityKey);
    try {
      const descriptionData = await fetchDescription({ descriptionUrl: opportunity.description });
      setDescriptions(prev => new Map(prev).set(opportunityKey, descriptionData));
    } catch (error) {
      console.error('Failed to load description:', error);
      toast({
        title: 'Error',
        description: 'Failed to fetch opportunity description',
        variant: 'destructive',
      });
    } finally {
      setLoadingOpportunity(null);
    }
  };

  return (
    <div className="space-y-3">
      {isLoading && !data && <LoadingState/>}

      {data && results.length === 0 && <EmptyState/>}

      {results.map((opportunity) => {
        const opportunityKey = opportunity.noticeId ?? opportunity.solicitationNumber ?? '';
        return (
          <SamGovOpportunityCard
            key={opportunity.noticeId ?? `${opportunity.solicitationNumber}-${opportunity.postedDate}-${opportunity.title}`}
            opportunity={opportunity}
            description={descriptions.get(opportunityKey) ?? null}
            isLoadingDescription={loadingOpportunity === opportunityKey}
            onViewDescription={handleViewDescription}
            onImportSolicitation={onImportSolicitation}
            isImporting={isLoading}
          />
        );
      })}

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