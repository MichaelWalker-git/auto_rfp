import React from 'react';
import { OpportunitiesList } from '@/components/opportunities/OpportunitiesList';

type Props = { params: Promise<{ projectId: string }> };

export default async function OpportunitiesPage({ params }: Props) {
  const { projectId } = await params;

  return (
    <div className="p-6">
      <div className="mb-4">
        <div className="text-xl font-semibold">Opportunities</div>
        <div className="text-sm text-muted-foreground">Stored opportunities for this project.</div>
      </div>

      <OpportunitiesList projectId={projectId}/>
    </div>
  );
}
