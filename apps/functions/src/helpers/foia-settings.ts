import type {
  FoiaSettingsItem,
  FoiaSettingsDBItem,
  FoiaSettingsUpdateRequest,
} from '@auto-rfp/core';
import { buildDefaultFoiaSettings } from '@auto-rfp/core';
import { getItem, putItem } from '@/helpers/db';
import { ORG_FOIA_SETTINGS_PK } from '@/constants/foia';
import { nowIso } from '@/helpers/date';

/**
 * Fetch FOIA settings for an organization.
 * Returns the built-in defaults when no record exists — callers never see null.
 */
export const getFoiaSettings = async (orgId: string): Promise<FoiaSettingsItem> => {
  const existing = await getItem<FoiaSettingsDBItem>(ORG_FOIA_SETTINGS_PK, orgId);
  return existing ?? buildDefaultFoiaSettings(orgId);
};

/**
 * Create or update FOIA settings for an organization.
 * Merges the patch over existing-or-default settings, preserving createdAt.
 */
export const upsertFoiaSettings = async (
  orgId: string,
  patch: FoiaSettingsUpdateRequest,
  updatedBy: string,
): Promise<FoiaSettingsItem> => {
  const now = nowIso();
  const existing = await getFoiaSettings(orgId);
  const createdAt = existing.createdAt ?? now;

  return putItem<FoiaSettingsItem>(
    ORG_FOIA_SETTINGS_PK,
    orgId,
    {
      ...existing,
      ...patch,
      orgId,
      updatedBy,
      createdAt,
    },
    false,
  );
};
