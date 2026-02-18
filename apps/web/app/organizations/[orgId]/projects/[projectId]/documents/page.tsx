import React, { Suspense } from 'react';
import { DocumentsSection } from '../../components/documents-section';
import { QuestionsProvider } from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';
import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';

interface DocumentsPageProps {
  params: Promise<{ orgId: string; projectId: string }>;
}

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const { orgId, projectId } = await params;

  return (
    <Suspense fallback={<PageLoadingSkeleton hasDescription variant="list" rowCount={4} />}>
      <QuestionsProvider projectId={projectId}>
        <DocumentsSection projectId={projectId} />
      </QuestionsProvider>
    </Suspense>
  );
}
