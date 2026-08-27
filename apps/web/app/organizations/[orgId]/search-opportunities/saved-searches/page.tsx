import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { SearchOpportunitiesRedirect } from '@/components/opportunities/SearchOpportunitiesRedirect';

interface Props {
  params: Promise<{ orgId: string }>;
}

/**
 * Retired org-level saved-searches route — forwards to the project-level one.
 */
export default async function SavedSearchesRoute({ params }: Props) {
  const { orgId } = await params;
  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
      <SearchOpportunitiesRedirect orgId={orgId} subPath="saved-searches" />
    </Suspense>
  );
}
