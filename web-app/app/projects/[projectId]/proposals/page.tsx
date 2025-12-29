import React from 'react';
import ProposalsContent from '@/app/projects/components/ProposalsContent';
import { QuestionsProvider } from '@/app/projects/[projectId]/questions/components';

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