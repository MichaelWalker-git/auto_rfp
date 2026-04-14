'use client';

import React, { use } from 'react';
import { useRouter } from 'next/navigation';
import { FolderPlus, Rocket } from 'lucide-react';
import type { z } from 'zod';
import type { CreateProjectSchema } from '@auto-rfp/core';

import { useToast } from '@/components/ui/use-toast';
import { useCreateProject } from '@/lib/hooks/use-create-project';
import { useAssignProjectAccess } from '@/lib/hooks/use-project-access';
import { ProjectForm, ProjectFormSkeleton } from '@/components/projects/ProjectForm';

// ─── Types ───

type CreateProjectFormValues = z.input<typeof CreateProjectSchema>;

interface CreateProjectPageProps {
  params: Promise<{ orgId: string }>;
}

// ─── Page ───

export default function CreateProjectPage({ params }: CreateProjectPageProps) {
  const { orgId } = use(params);
  const { toast } = useToast();
  const router = useRouter();
  const { createProject } = useCreateProject();
  const { assign } = useAssignProjectAccess();

  const projectsUrl = `/organizations/${orgId}/projects`;

  const handleSubmit = async (data: CreateProjectFormValues, selectedUserIds: Set<string>) => {
    const response = await createProject({
      orgId,
      name: data.name,
      description: data.description,
      ...((data.contactInfo?.primaryPocName || data.contactInfo?.primaryPocEmail || data.contactInfo?.primaryPocPhone || data.contactInfo?.primaryPocTitle)
        ? { contactInfo: data.contactInfo }
        : {}),
    });

    if (!response.id) {
      throw new Error('Failed to create project');
    }

    // Grant access to selected team members (in parallel, non-blocking for navigation)
    if (selectedUserIds.size > 0) {
      const assignPromises = Array.from(selectedUserIds).map((userId) =>
        assign({ orgId, userId, projectId: response.id }).catch((err) => {
          console.warn(`Failed to assign user ${userId} to project:`, err);
          return null;
        }),
      );
      Promise.all(assignPromises).then((results) => {
        const successCount = results.filter(Boolean).length;
        if (successCount > 0 && successCount < selectedUserIds.size) {
          toast({
            title: 'Partial Success',
            description: `Project created. ${successCount} of ${selectedUserIds.size} team members were added.`,
          });
        }
      });
    }

    toast({
      title: 'Project created',
      description: selectedUserIds.size > 0
        ? `"${response.name}" is ready. Adding ${selectedUserIds.size} team member(s)...`
        : `"${response.name}" is ready. Let's get started!`,
    });
    router.push(`/organizations/${orgId}/projects/${response.id}/dashboard`);
  };

  return (
    <ProjectForm
      orgId={orgId}
      project={null}
      title="Create Project"
      subtitle="Set up a new RFP project for your organization"
      headerIcon={<FolderPlus className="h-6 w-6 text-primary" />}
      submitLabel="Create Project"
      submittingLabel="Creating..."
      submitIcon={<Rocket className="h-4 w-4 mr-2" />}
      backUrl={projectsUrl}
      onSubmit={handleSubmit}
    />
  );
}