'use client';

import { use } from 'react';
import { ProjectContactSettings } from '@/components/projects/ProjectContactSettings';
import { ProjectKBSettings } from '@/components/projects/ProjectKBSettings';
import { useCurrentOrganization } from '@/context/organization-context';

interface ProjectSettingsPageProps {
  params: Promise<{ orgId: string; projectId: string }>;
}

export default function ProjectSettingsPage({ params }: ProjectSettingsPageProps) {
  const { orgId, projectId } = use(params);
  const { currentOrganization } = useCurrentOrganization();
  const resolvedOrgId = orgId ?? currentOrganization?.id ?? '';

  return (
    <div className="space-y-6 p-12">
      <div>
        <h1 className="text-2xl font-semibold">Project Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure project-level settings, contact information, and document folder assignments.
        </p>
      </div>

      {resolvedOrgId && (
        <>
          <ProjectContactSettings projectId={projectId} orgId={resolvedOrgId} />
          <ProjectKBSettings projectId={projectId} orgId={resolvedOrgId} />
        </>
      )}
    </div>
  );
}
