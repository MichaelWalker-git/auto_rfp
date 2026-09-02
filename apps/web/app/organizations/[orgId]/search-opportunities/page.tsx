import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { SearchOpportunitiesRedirect } from '@/components/opportunities/SearchOpportunitiesRedirect';

interface SearchOpportunitiesPageProps {
  params: Promise<{ orgId: string }>;
}

/**
 * Retired org-level search route — forwards to the canonical project-level page.
 * Kept as a redirect rather than deleted so existing bookmarks and shared search
 * URLs keep working.
 */
export default async function OpportunitiesPage({ params }: SearchOpportunitiesPageProps) {
  const { orgId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
      <SearchOpportunitiesRedirect orgId={orgId} />
    </Suspense>
  );
}
