'use client';

import React from 'react';
import { ExecutiveBriefView } from '@/components/brief/ExecutiveBriefView';
import { QuestionsProvider } from '../questions/components';

interface ExecutiveBriefContentProps {
  projectId: string;
}

export function ExecutiveBriefContent({ projectId }: ExecutiveBriefContentProps) {
  return (
    <div className="space-y-6 p-6 w-full">
      <QuestionsProvider projectId={projectId}>
        <ExecutiveBriefView projectId={projectId}/>
      </QuestionsProvider>
    </div>
  );
}
