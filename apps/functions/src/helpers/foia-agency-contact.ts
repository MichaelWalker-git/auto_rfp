import type {
  FoiaAgencyContactItem,
  FoiaAgencyContactDBItem,
  FoiaAgencyContactCreateRequest,
  FoiaAgencyContactUpdateRequest,
} from '@auto-rfp/core';
import { normalizeAgencyKey } from '@auto-rfp/core';
import { getItem, putItem, deleteItem, queryAllBySkPrefix } from '@/helpers/db';
import { ORG_AGENCY_CONTACT_PK } from '@/constants/foia';
import { nowIso } from '@/helpers/date';

/**
 * Build SK for an agency contact record.
 * SK pattern: `${orgId}#${agencyKey}` where agencyKey is normalized.
 */
export const buildAgencyContactSk = (orgId: string, agencyKey: string): string =>
  `${orgId}#${agencyKey}`;

/**
 * Fetch an agency contact by exact normalized key.
 * No fuzzy matching — sibling agencies have near-identical names, and a fuzzy
 * hit would confidently send a legal request to the wrong office.
 */
export const getAgencyContact = async (
  orgId: string,
  agencyName: string,
): Promise<FoiaAgencyContactDBItem | null> => {
  const agencyKey = normalizeAgencyKey(agencyName);
  return getItem<FoiaAgencyContactDBItem>(
    ORG_AGENCY_CONTACT_PK,
    buildAgencyContactSk(orgId, agencyKey),
  );
};

/**
 * List all agency contacts for an organization (paginated).
 */
export const listAgencyContacts = async (orgId: string): Promise<FoiaAgencyContactDBItem[]> => {
  const skPrefix = `${orgId}#`;
  return queryAllBySkPrefix<FoiaAgencyContactDBItem>(ORG_AGENCY_CONTACT_PK, skPrefix);
};

/**
 * Create or update an agency contact.
 * Sets verifiedAt to now on every write — the last successful use is the verification.
 */
export const upsertAgencyContact = async (
  orgId: string,
  dto: FoiaAgencyContactCreateRequest,
  userId: string,
): Promise<FoiaAgencyContactItem> => {
  const now = nowIso();
  const agencyKey = normalizeAgencyKey(dto.agencyName);
  const existing = await getAgencyContact(orgId, dto.agencyName);
  const createdAt = existing?.createdAt ?? now;

  return putItem<FoiaAgencyContactItem>(
    ORG_AGENCY_CONTACT_PK,
    buildAgencyContactSk(orgId, agencyKey),
    {
      ...dto,
      orgId,
      agencyKey,
      verifiedAt: now,
      createdAt,
      updatedBy: userId,
      createdBy: existing?.createdBy ?? userId,
    },
    false,
  );
};

/**
 * Mark an agency contact as bounced — sets acceptsEmail=false and records the
 * reason so a dead mailbox cannot silently swallow future requests.
 */
export const markAgencyContactBounced = async (
  orgId: string,
  agencyKey: string,
  reason: string,
): Promise<FoiaAgencyContactItem | null> => {
  const existing = await getItem<FoiaAgencyContactDBItem>(
    ORG_AGENCY_CONTACT_PK,
    buildAgencyContactSk(orgId, agencyKey),
  );

  if (!existing) return null;

  return putItem<FoiaAgencyContactItem>(
    ORG_AGENCY_CONTACT_PK,
    buildAgencyContactSk(orgId, agencyKey),
    {
      ...existing,
      acceptsEmail: false,
      lastBounceReason: reason,
    },
    false,
  );
};

/**
 * Remove an agency contact.
 */
export const deleteAgencyContact = async (orgId: string, agencyKey: string): Promise<void> => {
  await deleteItem(ORG_AGENCY_CONTACT_PK, buildAgencyContactSk(orgId, agencyKey));
};
