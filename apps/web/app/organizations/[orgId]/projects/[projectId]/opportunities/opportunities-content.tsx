'use client';

import React, { useState, useCallback } from 'react';
import { OpportunitiesList } from '@/components/opportunities/OpportunitiesList';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { CreateOpportunityDialog } from '@/components/opportunities/create-opportunity-dialog';
import { useSWRConfig } from 'swr';
import { env } from '@/lib/env';

interface OpportunitiesPageContentProps {
  projectId: string;
  orgId: string;
}

export function OpportunitiesPageContent({ projectId, orgId }: OpportunitiesPageContentProps) {
  const { mutate } = useSWRConfig();

  // Key to trigger list refresh
  const [refreshKey, setRefreshKey] = useState(0);

  const handleOpportunityCreated = useCallback(() => {
    // Build the exact cache key used by useOpportunitiesList
    const cacheKey = `${env.BASE_API_URL}/opportunity/get-opportunities?projectId=${projectId}&limit=25${orgId ? `&orgId=${orgId}` : ''}`;

    // Invalidate the cache and revalidate
    mutate(cacheKey);

    // Also trigger a refresh by updating the key
    setRefreshKey(prev => prev + 1);
  }, [projectId, orgId, mutate]);

  return (
    <div className="container mx-auto p-12">
      <ListingPageLayout
        title="Opportunities"
        description="Stored opportunities for this project."
        headerActions={
          <CreateOpportunityDialog
            projectId={projectId}
            onCreated={handleOpportunityCreated}
          />
        }
      >
        <OpportunitiesList key={refreshKey} projectId={projectId} />
      </ListingPageLayout>
    </div>
  );
}
