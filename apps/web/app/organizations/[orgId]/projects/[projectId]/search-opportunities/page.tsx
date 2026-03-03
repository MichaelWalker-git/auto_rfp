import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import ProjectSearchOpportunitiesPage from '@/components/opportunities/ProjectSearchOpportunitiesPage';

interface Props {
  params: Promise<{ orgId: string; projectId: string }>;
}

export default async function SearchOpportunitiesPage({ params }: Props) {
  const { orgId, projectId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
      <ProjectSearchOpportunitiesPage orgId={orgId} projectId={projectId} />
    </Suspense>
  );
}
