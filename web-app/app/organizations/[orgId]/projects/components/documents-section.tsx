'use client';

import { useSearchParams } from 'next/navigation';
import { ProjectDocuments } from '@/components/projects/ProjectDocuments';
import {
  NoRfpDocumentAvailable,
  useQuestions
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';

type Props = {
  projectId?: string;
}

export function DocumentsSection({ projectId: propProjectId }: Props) {
  const searchParams = useSearchParams();
  const projectId = propProjectId || searchParams.get('projectId');

  if (!projectId) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <p className="text-muted-foreground">No project selected</p>
        </div>
      </div>
    );
  }

  const { questions, isLoading, error } = useQuestions();

  if (!isLoading && !error && !questions) {
    return <NoRfpDocumentAvailable projectId={projectId}/>;
  }

  return (
    <div className="space-y-6 p-12">
      <ProjectDocuments projectId={projectId}/>
    </div>
  );
}
