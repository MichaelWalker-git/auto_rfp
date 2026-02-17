import React from 'react';
import { OpportunityView } from '@/components/opportunities/OpportunityView';

type Props = {
  params: Promise<{
    orgId: string;
    projectId: string;
    oppId: string;
  }>;
};

export default async function OpportunityPage({ params }: Props) {

  const { orgId, projectId, oppId } = await params;

  return (
    <div className="container mx-auto p-12">
      <OpportunityView projectId={projectId} oppId={oppId}/>
    </div>
  );
}
