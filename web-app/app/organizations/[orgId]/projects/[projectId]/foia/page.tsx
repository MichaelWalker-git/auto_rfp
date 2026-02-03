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
    <div className="w-full max-w-4xl mx-auto space-y-6 p-6">
      <div className="pb-8">
        <h1 className="text-3xl font-bold tracking-tight">FOIA Requests</h1>
        <p className="text-muted-foreground mt-2">
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