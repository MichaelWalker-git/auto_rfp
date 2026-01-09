// Example usage (page/tab)
// app/projects/[projectId]/opportunities/page.tsx
'use client';

import React from 'react';
import OpportunitiesList from '@/components/opportunities/OpportunitiesList';
import type { OpportunityItem } from '@auto-rfp/shared';

export default function OpportunitiesPage({ params }: { params: { projectId: string } }) {
  return (
    <div className="p-6">
      <div className="mb-4">
        <div className="text-xl font-semibold">Opportunities</div>
        <div className="text-sm text-muted-foreground">Stored opportunities for this project.</div>
      </div>

      <OpportunitiesList
        projectId={params.projectId}
        onOpen={(item: OpportunityItem) => {
          console.log('open', item);
        }}
      />
    </div>
  );
}