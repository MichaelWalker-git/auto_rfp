'use client';

import React, { useState, useCallback } from 'react';
import { OpportunitiesList } from '@/components/opportunities/OpportunitiesList';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import { CreateOpportunityDialog } from '@/components/opportunities/create-opportunity-dialog';
import { useParams } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { env } from '@/lib/env';
import { useCurrentOrganization } from '@/context/organization-context';

export default function OpportunitiesPage() {
  const params = useParams<{ projectId: string; orgId: string }>();
  const { mutate } = useSWRConfig();
  const { currentOrganization } = useCurrentOrganization();
  const projectId = params?.projectId || '';
  const orgId = params?.orgId || currentOrganization?.id || '';
  
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
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
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
        <OpportunitiesList key={refreshKey} projectId={projectId}/>
      </ListingPageLayout>
    </div>
  );
}
