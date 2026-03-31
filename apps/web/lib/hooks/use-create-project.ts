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

    // Invalidate the project list cache so the new project appears immediately
    await mutate(
      (key: unknown) => Array.isArray(key) && key[0] === 'project/projects',
    );

    return project;
  };

  return { createProject };
}
