'use client';

import { apiMutate, buildApiUrl } from './api-helpers';
import { OrganizationItem } from '@auto-rfp/core';

interface CreateOrganizationPayload {
  name: string;
  description?: string;
  bucketName?: string;
  iconKey?: string;
}

export function useCreateOrganization() {
  const createOrganization = async (payload: CreateOrganizationPayload): Promise<OrganizationItem> => {
    return apiMutate<OrganizationItem>(buildApiUrl('organization/create-organization'), 'POST', payload);
  };

  return { createOrganization };
}
