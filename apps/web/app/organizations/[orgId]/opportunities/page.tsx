import React, { Suspense } from 'react';
import SamGovOpportunitySearchPage from '@/components/opportunities/samgov-opportunity-search';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

interface OpportunitiesPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function OpportunitiesPage({ params }: OpportunitiesPageProps) {
  const { orgId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
      <SamGovOpportunitySearchPage orgId={orgId} />
    </Suspense>
  );
}
