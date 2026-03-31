'use client';

import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from './api-helpers';
import { ProjectItem } from '@auto-rfp/core';
import { breadcrumbs } from '@/lib/sentry';

type CreateProjectPayload = {
  orgId: string;
  name: string;
  description?: string;
};

export function useCreateProject() {
  const { mutate } = useSWRConfig();

  const createProject = async (payload: CreateProjectPayload): Promise<ProjectItem> => {
    const project = await apiMutate<ProjectItem>(buildApiUrl('projects/create'), 'POST', payload);
    breadcrumbs.projectCreated(project.id, project.name);
    
    // Revalidate project-related caches so the new project shows up immediately
    await Promise.all([
      mutate((key: unknown) => Array.isArray(key) && key[0] === 'project/projects'),
      mutate(['my-project-access', payload.orgId]),
    ]);

    return project;
  };

  return { createProject };
}
