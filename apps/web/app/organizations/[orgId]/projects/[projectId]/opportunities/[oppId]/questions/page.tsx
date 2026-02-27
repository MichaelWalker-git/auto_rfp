import React, { Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { QuestionsSection } from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';

type Props = { 
  params: Promise<{ 
    projectId: string;
    orgId: string;
    oppId: string;
  }>;
};

export default async function OpportunityQuestionsPage({ params }: Props) {
  const { projectId, orgId, oppId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={5} />}>
      <QuestionsSection 
        orgId={orgId} 
        projectId={projectId} 
        initialOpportunityId={oppId}
        hideOpportunitySelector
      />
      <Toaster/>
    </Suspense>
  );
}
