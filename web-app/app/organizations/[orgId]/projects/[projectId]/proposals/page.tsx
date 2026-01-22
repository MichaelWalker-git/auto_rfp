import React from 'react';
import { QuestionsProvider } from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';
import ProposalsContent from '@/app/organizations/[orgId]/projects/components/ProposalsContent';

interface ProposalsPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function ProposalsPage({ params }: ProposalsPageProps) {
  const { projectId } = await params;

  return (
    <div className="space-y-6 p-12">
      <QuestionsProvider projectId={projectId}>
        <ProposalsContent projectId={projectId}/>
      </QuestionsProvider>
    </div>
  );
}