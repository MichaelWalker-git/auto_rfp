'use client';

import { apiMutate, buildApiUrl } from './api-helpers';
interface DeleteOrganizationResponse {
  message: string;
  orgId: string;
}

export function useDeleteOrganization() {
  const deleteOrganization = async (orgId: string): Promise<DeleteOrganizationResponse> => {
    return apiMutate<DeleteOrganizationResponse>(
      buildApiUrl(`organization/delete-organization/${encodeURIComponent(orgId)}`),
      'DELETE',
    );
  };

  return { deleteOrganization };
}
