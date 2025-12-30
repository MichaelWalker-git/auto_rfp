'use client';

import { Suspense } from 'react';
import { PageSkeleton } from '@/components/projects/PageSkeleton';
import OrganisationDeadlinesContent from '@/components/organizations/OrganisationDeadlinesContent'

interface OrgDeadlinesPageProps {
  params: Promise<{
    orgId: string;
  }>;
}

export default function KnowledgeBasePage({ params }: OrgDeadlinesPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OrganisationDeadlinesContent params={params}/>
    </Suspense>
  );
}

