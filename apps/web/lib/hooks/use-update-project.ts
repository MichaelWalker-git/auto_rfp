'use client';

import { apiMutate, buildApiUrl } from './api-helpers';
import type { ProjectItem, ProjectContactInfo } from '@auto-rfp/core';

type UpdateProjectPayload = {
  orgId: string;
  projectId: string;
  name: string;
  description?: string;
  contactInfo?: ProjectContactInfo;
};

export const useUpdateProject = () => {
  const updateProject = async (payload: UpdateProjectPayload): Promise<ProjectItem> => {
    return apiMutate<ProjectItem>(
      buildApiUrl(`projects/update/${payload.projectId}`, { orgId: payload.orgId }),
      'PUT',
      { name: payload.name, description: payload.description, contactInfo: payload.contactInfo },
    );
  };

  return { updateProject };
};
