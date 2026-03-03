import { useApi, apiMutate, buildApiUrl, ApiError } from './api-helpers';
import type { OrgPrimaryContactItem, CreateOrgPrimaryContactDTO } from '@auto-rfp/core';

export interface OrgPrimaryContactResponse {
  contact: OrgPrimaryContactItem;
}

export const useOrgPrimaryContact = (orgId: string | null) => {
  const url = orgId ? buildApiUrl(`organization/${orgId}/contact`) : null;
  return useApi<OrgPrimaryContactResponse>(
    orgId ? ['org-contact', orgId] : null,
    url,
    {
      // 404 means no contact exists yet — treat as empty, do not retry
      shouldRetryOnError: (err) => !(err instanceof ApiError && err.status === 404),
    },
  );
};

export const upsertOrgPrimaryContactApi = (
  orgId: string,
  dto: CreateOrgPrimaryContactDTO,
): Promise<OrgPrimaryContactResponse> =>
  apiMutate<OrgPrimaryContactResponse>(
    buildApiUrl(`organization/${orgId}/contact`),
    'PUT',
    dto,
  );

export const deleteOrgPrimaryContactApi = (orgId: string): Promise<void> =>
  apiMutate<void>(buildApiUrl(`organization/${orgId}/contact`), 'DELETE');
