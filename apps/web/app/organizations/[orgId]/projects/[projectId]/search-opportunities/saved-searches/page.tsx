import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import ProjectSavedSearchesPage from '@/components/opportunities/ProjectSavedSearchesPage';

interface Props {
  params: Promise<{ orgId: string; projectId: string }>;
}

export default async function SavedSearchesRoute({ params }: Props) {
  const { orgId, projectId } = await params;
  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
      <ProjectSavedSearchesPage orgId={orgId} projectId={projectId} />
    </Suspense>
  );
}
