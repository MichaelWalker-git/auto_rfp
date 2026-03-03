import type { OrgPrimaryContactItem, CreateOrgPrimaryContactDTO } from '@auto-rfp/core';
import { getItem, putItem, deleteItem } from '@/helpers/db';
import { ORG_CONTACT_PK } from '@/constants/organization';
import { nowIso } from '@/helpers/date';

/**
 * Fetch the primary contact for an organization.
 * Returns null if no contact has been configured.
 */
export const getOrgPrimaryContact = async (orgId: string): Promise<OrgPrimaryContactItem | null> =>
  getItem<OrgPrimaryContactItem>(ORG_CONTACT_PK, orgId);

/**
 * Create or update the primary contact for an organization.
 * Reads the existing record first to preserve the original createdAt on updates.
 */
export const upsertOrgPrimaryContact = async (
  orgId: string,
  dto: CreateOrgPrimaryContactDTO,
  updatedBy: string,
): Promise<OrgPrimaryContactItem> => {
  const now = nowIso();
  // Read existing record to preserve original createdAt
  const existing = await getOrgPrimaryContact(orgId);
  const createdAt = existing?.createdAt ?? now;

  return putItem<OrgPrimaryContactItem>(
    ORG_CONTACT_PK,
    orgId,
    {
      ...dto,
      orgId,
      updatedBy,
      createdAt,
    },
    false, // createdAt is explicitly set above — no need for preserveCreatedAt logic
  );
};

/**
 * Remove the primary contact for an organization.
 */
export const deleteOrgPrimaryContact = async (orgId: string): Promise<void> => {
  await deleteItem(ORG_CONTACT_PK, orgId);
};
