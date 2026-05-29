'use client';

import { apiMutate, buildApiUrl } from './api-helpers';
import { DeleteOrganizationResponse } from '@auto-rfp/core';

export function useDeleteOrganization() {
  const deleteOrganization = async (orgId: string): Promise<DeleteOrganizationResponse> => {
    return apiMutate<DeleteOrganizationResponse>(
      buildApiUrl(`organization/delete-organization/${encodeURIComponent(orgId)}`),
      'DELETE',
    );
  };

  return { deleteOrganization };
}
