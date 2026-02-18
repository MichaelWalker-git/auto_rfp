import React, { Suspense } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { OpportunitiesPageContent } from './opportunities-content';

function OpportunitiesLoadingFallback() {
  return (
    <div className="flex flex-col items-center justify-center h-64">
      <Spinner size="lg" className="mb-4" />
      <p>Loading opportunities...</p>
    </div>
  );
}

interface OpportunitiesPageProps {
  params: Promise<{ projectId: string; orgId: string }>;
}

export default async function OpportunitiesPage({ params }: OpportunitiesPageProps) {
  const { projectId, orgId } = await params;

  return (
    <Suspense fallback={<OpportunitiesLoadingFallback />}>
      <OpportunitiesPageContent projectId={projectId} orgId={orgId} />
    </Suspense>
  );
}
