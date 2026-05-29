import React, { Suspense } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { ProjectsPageContent } from './projects-content';

function ProjectsLoadingFallback() {
  return (
    <div className="container mx-auto p-12">
      <div className="flex justify-between items-center mb-6">
        <div>
          <Skeleton className="h-9 w-48 mb-2" />
          <Skeleton className="h-5 w-72" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      <div className="mb-8">
        <Skeleton className="h-7 w-24 mb-4" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ProjectsPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function ProjectsPage({ params }: ProjectsPageProps) {
  const { orgId } = await params;

  return (
    <Suspense fallback={<ProjectsLoadingFallback />}>
      <ProjectsPageContent orgId={orgId} />
    </Suspense>
  );
}
