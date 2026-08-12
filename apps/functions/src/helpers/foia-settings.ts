import type {
  FoiaSettingsItem,
  FoiaSettingsDBItem,
  FoiaSettingsUpdateRequest,
} from '@auto-rfp/core';
import { buildDefaultFoiaSettings } from '@auto-rfp/core';
import { getItem, putItem, queryBySkPrefix } from '@/helpers/db';
import { ORG_FOIA_SETTINGS_PK } from '@/constants/foia';
import { nowIso } from '@/helpers/date';

/** Strips a display name and angle brackets from an address header. */
const bareAddress = (value: string): string => {
  const angled = /<([^>]+)>/.exec(value);
  return (angled?.[1] ?? value).trim().toLowerCase();
};

/**
 * Finds the organization that owns a monitored mailbox.
 *
 * Inbound mail carries no tenant, so ingestion must attribute it before it can
 * touch anything. `scrapeMailbox` is that link: an org names the address it
 * forwards from, and mail to that address can only ever be attributed to that org.
 *
 * Returns null unless exactly one org claims the address AND has Level 1 enabled.
 * Both halves matter. An org that has not enabled the scrape has not consented to
 * having its opportunities moved by email. And if two orgs somehow claimed the
 * same mailbox, attributing to either would leak one tenant's procurement
 * correspondence into the other's records — so an ambiguous claim refuses.
 *
 * Deliberately a scan of the settings partition rather than a GSI. There is one
 * settings row per org, the partition is tiny, and adding an index to the shared
 * table for a per-message lookup would cost more than it saves.
 */
export const findOrgByScrapeMailbox = async (recipients: readonly string[]): Promise<string | null> => {
  const wanted = new Set(recipients.map(bareAddress).filter((a) => a.length > 0));
  if (wanted.size === 0) return null;

  const all = await queryBySkPrefix<FoiaSettingsDBItem>(ORG_FOIA_SETTINGS_PK, '');

  const claiming = all.filter(
    (settings) =>
      settings.mailScrapeEnabled === true &&
      !!settings.scrapeMailbox &&
      wanted.has(bareAddress(settings.scrapeMailbox)),
  );

  return claiming.length === 1 ? (claiming[0] as FoiaSettingsDBItem).orgId : null;
};

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
