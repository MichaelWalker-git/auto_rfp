'use client';

import { apiFetcher, buildApiUrl } from './api-helpers';
import { Organization } from '@auto-rfp/shared';

export function useGetOrganizationById() {
  const getOrganizationById = async (id: string): Promise<Organization> => {
    if (!id) {
      throw new Error('Organization id is required');
    }

    return apiFetcher<Organization>(buildApiUrl(`organization/${encodeURIComponent(id)}`));
  };

  return { getOrganizationById };
}
