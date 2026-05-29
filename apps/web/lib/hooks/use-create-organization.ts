'use client';

import { apiMutate, buildApiUrl } from './api-helpers';
import { Organization } from '@auto-rfp/core';

interface CreateOrganizationPayload {
  name: string;
  description?: string;
  bucketName?: string;
  iconKey?: string;
}

export function useCreateOrganization() {
  const createOrganization = async (payload: CreateOrganizationPayload): Promise<Organization> => {
    return apiMutate<Organization>(buildApiUrl('organization/create-organization'), 'POST', payload);
  };

  return { createOrganization };
}
