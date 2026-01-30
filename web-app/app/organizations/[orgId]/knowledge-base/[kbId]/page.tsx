'use client';

import { Suspense } from 'react';
import { PageSkeleton } from '@/components/projects/PageSkeleton';
import KnowledgeBaseItemComponent from '@/components/kb/KnowledgeBaseItemComponent';

interface KnowledgeBasePageProps {
  params: Promise<{
    orgId: string;
  }>;
}

export default function KnowledgeBasePage({ params }: KnowledgeBasePageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <KnowledgeBaseItemComponent />
    </Suspense>
  );
}

