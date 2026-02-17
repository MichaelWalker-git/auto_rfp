'use client';

import { apiMutate, buildApiUrl } from './api-helpers';
import { ProjectItem } from '@auto-rfp/shared';

type UpdateProjectPayload = {
  orgId: string;
  projectId: string;
  name: string;
  description?: string;
};

export function useUpdateProject() {
  const updateProject = async (payload: UpdateProjectPayload): Promise<ProjectItem> => {
    return apiMutate<ProjectItem>(
      buildApiUrl(`projects/update/${payload.projectId}`, { orgId: payload.orgId }),
      'PUT',
      { name: payload.name, description: payload.description },
    );
  };

  return { updateProject };
}
