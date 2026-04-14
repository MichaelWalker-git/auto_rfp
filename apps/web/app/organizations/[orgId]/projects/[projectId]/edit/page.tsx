'use client';

import React, { use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSWRConfig } from 'swr';
import { FolderOpen, Save } from 'lucide-react';
import type { z } from 'zod';
import type { CreateProjectSchema } from '@auto-rfp/core';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useUpdateProject } from '@/lib/hooks/use-update-project';
import { useProject } from '@/lib/hooks/use-api';
import { ProjectForm, ProjectFormSkeleton } from '@/components/projects/ProjectForm';

// ─── Types ───

type ProjectFormValues = z.input<typeof CreateProjectSchema>;

interface EditProjectPageProps {
  params: Promise<{ orgId: string; projectId: string }>;
}

// ─── Not Found State ───

const ProjectNotFound = ({ backUrl }: { backUrl: string }) => (
  <div className="container max-w-3xl mx-auto py-16 px-4">
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <FolderOpen className="h-6 w-6 text-muted-foreground" />
      </div>
      <h2 className="text-xl font-semibold mb-2">Project not found</h2>
      <p className="text-muted-foreground mb-6">
        The project you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
      </p>
      <Button asChild>
        <Link href={backUrl}>Back to Projects</Link>
      </Button>
    </div>
  </div>
);

// ─── Page ───

export default function EditProjectPage({ params }: EditProjectPageProps) {
  const { orgId, projectId } = use(params);
  const { toast } = useToast();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { updateProject } = useUpdateProject();
  const { data: project, isLoading } = useProject(projectId);

  const projectsUrl = `/organizations/${orgId}/projects`;

  const handleSubmit = async (data: ProjectFormValues) => {
    const response = await updateProject({
      orgId,
      projectId,
      name: data.name,
      description: data.description,
      ...((data.contactInfo?.primaryPocName || data.contactInfo?.primaryPocEmail || data.contactInfo?.primaryPocPhone || data.contactInfo?.primaryPocTitle)
        ? { contactInfo: data.contactInfo }
        : {}),
    });

    if (!response.id) {
      throw new Error('Failed to update project');
    }

    await Promise.all([
      mutate((key: unknown) =>
        Array.isArray(key) && key[0] === 'project' && key[1] === projectId,
      ),
      mutate((key: unknown) =>
        Array.isArray(key) && key[0] === 'project/projects',
      ),
    ]);

    toast({
      title: 'Project updated',
      description: `"${response.name}" has been saved successfully.`,
    });
    router.push(projectsUrl);
  };

  if (isLoading) {
    return <ProjectFormSkeleton />;
  }

  if (!project) {
    return <ProjectNotFound backUrl={projectsUrl} />;
  }

  return (
    <ProjectForm
      orgId={orgId}
      project={project}
      title="Edit Project"
      subtitle={<>Update details for <span className="font-medium text-foreground">{project.name}</span></>}
      headerIcon={<FolderOpen className="h-6 w-6 text-primary" />}
      submitLabel="Save Changes"
      submittingLabel="Saving..."
      submitIcon={<Save className="h-4 w-4 mr-2" />}
      backUrl={projectsUrl}
      onSubmit={handleSubmit}
    />
  );
}