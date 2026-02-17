'use client';

import { apiMutate, buildApiUrl } from './api-helpers';
import { ProjectItem } from '@auto-rfp/shared';
import { breadcrumbs } from '@/lib/sentry';

type CreateProjectPayload = {
  orgId: string;
  name: string;
  description?: string;
};

export function useCreateProject() {
  const createProject = async (payload: CreateProjectPayload): Promise<ProjectItem> => {
    const project = await apiMutate<ProjectItem>(buildApiUrl('projects/create'), 'POST', payload);
    breadcrumbs.projectCreated(project.id, project.name);
    return project;
  };

  return { createProject };
}
