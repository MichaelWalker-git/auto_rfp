import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import SearchOpportunitiesPage from '@/components/opportunities/SearchOpportunitiesPage';

interface SearchOpportunitiesPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function OpportunitiesPage({ params }: SearchOpportunitiesPageProps) {
  const { orgId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
      <SearchOpportunitiesPage orgId={orgId} />
    </Suspense>
  );
}
