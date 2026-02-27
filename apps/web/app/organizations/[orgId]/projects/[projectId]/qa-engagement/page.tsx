import React, { Suspense } from 'react';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { ProjectPageProvider } from '@/app/organizations/[orgId]/projects/components/project-page-provider';
import { QAEngagementPageContent } from './qa-engagement-content';

interface QAEngagementPageProps {
  params: Promise<{ projectId: string; orgId: string }>;
  searchParams: Promise<{ oppId?: string }>;
}

export default async function QAEngagementPage({ params, searchParams }: QAEngagementPageProps) {
  const { projectId, orgId } = await params;
  const { oppId } = await searchParams;

  return (
    <ProjectPageProvider projectId={projectId}>
      <Suspense fallback={<PageLoadingSkeleton variant="detail" hasDescription />}>
        <QAEngagementPageContent 
          orgId={orgId} 
          projectId={projectId} 
          initialOpportunityId={oppId} 
        />
      </Suspense>
    </ProjectPageProvider>
  );
}
