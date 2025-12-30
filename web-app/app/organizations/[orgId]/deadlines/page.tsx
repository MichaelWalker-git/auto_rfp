'use client';

import { Suspense } from 'react';
import { PageSkeleton } from '@/components/projects/PageSkeleton';
import OrganizationDeadlinesContent from '@/components/organizations/OrganizationDeadlinesContent'

interface OrgDeadlinesPageProps {
  params: Promise<{
    orgId: string;
  }>;
}

export default function OrgDeadlinesPage({ params }: OrgDeadlinesPageProps) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <OrganizationDeadlinesContent params={params}/>
    </Suspense>
  );
}

