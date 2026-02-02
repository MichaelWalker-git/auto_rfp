'use client';

import React, { Suspense, useState } from 'react';
import { ProjectOverview } from './project-overview';
import { QuestionsProvider, QuestionsSection } from '../[projectId]/questions/components';
import { DocumentsSection } from './documents-section';
import { TeamSection } from './team-section';
import ProposalsContent from '@/app/organizations/[orgId]/projects/components/ProposalsContent';
import { useProject } from '@/lib/hooks/use-api';
import { useSentryProject } from '@/lib/hooks/use-sentry-context';
import { useCurrentOrganization } from '@/context/organization-context';

function ProjectContentInner({ projectId }: { projectId: string }) {
  const [activeSection, setActiveSection] = useState('overview');
  const { data: project } = useProject(projectId);
  const { currentOrganization } = useCurrentOrganization();

  // Set Sentry context for error tracking
  useSentryProject(project ? { id: project.id, name: project.name, orgId: project.orgId } : null);

  const renderContent = () => {
    switch (activeSection) {
      case 'questions':
        return <QuestionsSection orgId={currentOrganization?.id || ''} projectId={projectId}/>;
      case 'documents':
        return <DocumentsSection/>;
      case 'team':
        return <TeamSection/>;
      case 'proposals':
        return <ProposalsContent projectId={projectId}/>;
      case 'overview':
      default:
        return (
          <ProjectOverview projectId={projectId}/>
        );
    }
  };

  return (
    <div className="container py-6">
      <QuestionsProvider projectId={projectId}>
        {renderContent()}
      </QuestionsProvider>
    </div>
  );
}

export function ProjectContent({ projectId }: { projectId: string }) {
  return (
    <Suspense fallback={
      <div className="container py-6">
        <div className="space-y-4">
          <div className="h-10 w-48 animate-pulse bg-muted rounded"></div>
          <div className="h-32 animate-pulse bg-muted rounded"></div>
          <div className="h-64 animate-pulse bg-muted rounded"></div>
        </div>
      </div>
    }>
      <ProjectContentInner projectId={projectId}/>
    </Suspense>
  );
}
