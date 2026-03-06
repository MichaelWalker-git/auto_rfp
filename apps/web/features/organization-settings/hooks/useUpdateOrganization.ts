'use client';

import { useState, useCallback } from 'react';
import { mutate as globalMutate } from 'swr';
import { useToast } from '@/components/ui/use-toast';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { OrganizationItem, UpdateOrganizationDTO } from '@auto-rfp/core';

interface UseUpdateOrganizationResult {
  updateOrganization: (data: UpdateOrganizationDTO) => Promise<OrganizationItem | null>;
  isSaving: boolean;
}

export const useUpdateOrganization = (
  orgId: string,
  mutateOrg: () => Promise<OrganizationItem | undefined>
): UseUpdateOrganizationResult => {
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const updateOrganization = useCallback(
    async (data: UpdateOrganizationDTO): Promise<OrganizationItem | null> => {
      try {
        setIsSaving(true);

        const url = `${env.BASE_API_URL}/organization/edit-organization/${orgId}`;
        const response = await authFetcher(url, {
          method: 'PATCH',
          body: JSON.stringify(data),
        });

        if (!response.ok) {
          throw new Error('Failed to update organization');
        }

        const updatedOrg: OrganizationItem = await response.json();

        // Refresh local org SWR cache
        await mutateOrg();

        // Force revalidate the global organizations list used by OrganizationContext
        // (sidebar, header, org switcher). The SWR key is an array ['organization/organizations']
        // and has dedupingInterval: 60s, so we must force revalidation.
        await globalMutate(
          (key: unknown) => Array.isArray(key) && key[0] === 'organization/organizations',
          undefined,
          { revalidate: true }
        );

        toast({
          title: 'Success',
          description: 'Organization settings updated',
        });

        return updatedOrg;
      } catch (error) {
        console.error('Error updating organization:', error);
        toast({
          title: 'Error',
          description: 'Failed to update organization settings',
          variant: 'destructive',
        });
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [orgId, mutateOrg, toast]
  );

  return {
    updateOrganization,
    isSaving,
  };
};
