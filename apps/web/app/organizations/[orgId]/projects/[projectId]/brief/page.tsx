import React, { Suspense } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { ProjectPageProvider } from '@/app/organizations/[orgId]/projects/components/project-page-provider';
import { ExecutiveBriefContent } from './executive-brief-content';

function BriefPageLoading() {
  return (
    <div className="flex flex-col items-center justify-center h-64">
      <Spinner size="lg" className="mb-4"/>
      <p>Loading executive brief...</p>
    </div>
  );
}

interface BriefPageProps {
  params: Promise<{ projectId: string; orgId: string }>;
  searchParams: Promise<{ oppId?: string }>;
}

export default async function BriefPage({ params, searchParams }: BriefPageProps) {
  const { projectId } = await params;
  const { oppId } = await searchParams;

  return (
    <ProjectPageProvider projectId={projectId}>
      <Suspense fallback={<BriefPageLoading/>}>
        <ExecutiveBriefContent projectId={projectId} initialOpportunityId={oppId}/>
      </Suspense>
    </ProjectPageProvider>
  );
}
