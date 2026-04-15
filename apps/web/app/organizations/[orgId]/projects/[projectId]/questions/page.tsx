import React, { Suspense } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

import { QuestionsSection } from './components';

interface QuestionsPageProps {
  params: Promise<{ projectId: string; orgId: string }>;
  searchParams: Promise<{ oppId?: string }>;
}

export default async function QuestionsPage({ params, searchParams }: QuestionsPageProps) {
  const { projectId, orgId } = await params;
  const { oppId } = await searchParams;

  return (
    <Suspense fallback={<PageLoadingSkeleton variant="list" hasDescription rowCount={5}/>}>
      <QuestionsSection orgId={orgId} projectId={projectId} initialOpportunityId={oppId}/>
      <Toaster/>
    </Suspense>
  );
}
