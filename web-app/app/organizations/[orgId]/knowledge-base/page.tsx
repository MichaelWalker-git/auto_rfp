'use client';

import { Suspense } from 'react';
import { PageSkeleton } from '@/components/projects/PageSkeleton';
import { KnowledgeBaseContent } from '@/components/organizations/KnowledgeBaseContent';

interface KnowledgeBasePageProps {
  params: Promise<{
    orgId: string;
  }>;
}

export default function KnowledgeBasePage({ params }: KnowledgeBasePageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KnowledgeBasePageContent params={params} />
    </Suspense>
  );
}

function KnowledgeBasePageContent({ params }: KnowledgeBasePageProps) {
  return <KnowledgeBaseContent params={params} />;
}
