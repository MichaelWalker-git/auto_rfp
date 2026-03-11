'use client';

import { apiFetcher, buildApiUrl } from './api-helpers';
import { OrganizationItem } from '@auto-rfp/core';

export function useGetOrganizationById() {
  const getOrganizationById = async (id: string): Promise<OrganizationItem> => {
    if (!id) {
      throw new Error('Organization id is required');
    }

    return apiFetcher<OrganizationItem>(buildApiUrl(`organization/${encodeURIComponent(id)}`));
  };

  return { getOrganizationById };
}
