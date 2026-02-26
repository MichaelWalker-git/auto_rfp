import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import SavedSearchesPage from '@/components/opportunities/SavedSearchesPage';

interface Props {
  params: Promise<{ orgId: string }>;
}

export default async function SavedSearchesRoute({ params }: Props) {
  const { orgId } = await params;
  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
      <SavedSearchesPage orgId={orgId} />
    </Suspense>
  );
}
