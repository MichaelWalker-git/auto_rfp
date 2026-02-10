'use client';

import { FOIARequestCard } from '@/components/foia/FOIARequestCard';
import { use } from 'react';

interface FOIAPageProps {
  params: Promise<{
    orgId: string;
    projectId: string;
  }>;
}

export default function FOIAPage({ params }: FOIAPageProps) {
  const { orgId, projectId } = use(params);

  return (
    <div className="w-full space-y-6 p-6">
      <div className="pb-4">
        <h1 className="text-2xl font-semibold tracking-tight">FOIA Requests</h1>
        <p className="text-muted-foreground mt-1">
          Manage Freedom of Information Act requests for evaluation documents
        </p>
      </div>

      <div className="grid gap-6">
        <FOIARequestCard
          projectId={projectId}
          orgId={orgId}
          projectOutcomeStatus="LOST"
        />
      </div>
    </div>
  );
}