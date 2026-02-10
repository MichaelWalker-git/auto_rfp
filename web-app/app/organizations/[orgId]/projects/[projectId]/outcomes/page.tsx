'use client';

import { ProjectOutcomeCard } from '@/components/project-outcome/ProjectOutcomeCard';
import { use } from 'react';

interface OutcomesPageProps {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

export default function OutcomesPage({ params }: OutcomesPageProps) {
  const { orgId, projectId } = use(params);

  return (
    <div className="w-full space-y-6 p-6">
      <div className="pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Project Outcomes</h1>
        <p className="text-muted-foreground mt-1">
          Track and manage the outcome of your proposal submissions
        </p>
      </div>

      <div className="grid gap-6">
        <ProjectOutcomeCard
          projectId={projectId}
          orgId={orgId}
        />
      </div>
    </div>
  );
}