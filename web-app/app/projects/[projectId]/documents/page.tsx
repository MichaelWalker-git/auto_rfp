import React from 'react';
import { DocumentsSection } from '../../components/documents-section';
import { QuestionsProvider } from '@/app/projects/[projectId]/questions/components';

interface DocumentsPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const { projectId } = await params;

  return (
    <QuestionsProvider projectId={projectId}>
      <DocumentsSection projectId={projectId}/>
    </QuestionsProvider>
  );
} 