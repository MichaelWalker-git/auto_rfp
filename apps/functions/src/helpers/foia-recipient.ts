import type {
  FoiaBlockedReason,
  FoiaRecipientCandidate,
  FoiaRecipientSource,
  OpportunityDBItem,
} from '@auto-rfp/core';

import { getAgencyContact } from '@/helpers/foia-agency-contact';
import { scanSolicitationsForFoiaContact } from '@/helpers/foia-doc-scan';

/**
 * Resolves where an automatic FOIA request should be sent.
 *
 * There is no standard for how a solicitation names its records contact, so the
 * resolver tries four sources in priority order and records which one won. Only
 * a human-supplied or feed-supplied address is ever used automatically; the
 * document scan produces candidates that must be confirmed first.
 *
 * Tier order:
 *   1. `opportunity.foiaContactEmail`  — explicit FOIA-office override
 *   2. `opportunity.contactEmail`      — auto-populated by solicitation import
 *   3. solicitation document text scan — candidates only, needs confirmation
 *   4. the org's agency-contact directory
 *
 * Nothing resolved → blocked, never guessed.
 */

export interface ResolvedFoiaRecipient {
  email?: string;
  address?: string;
  name?: string;
  source?: FoiaRecipientSource;
  /** Populated when `blockedReason` is NEEDS_CONFIRMATION. */
  candidates?: FoiaRecipientCandidate[];
  /** Set when no address could be used without human input. */
  blockedReason?: FoiaBlockedReason;
  /** Portal URL to show the user when the agency refuses email. */
  webPortalUrl?: string;
}

const trimmed = (value: string | null | undefined): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const next = value.trim();
  return next.length > 0 ? next : undefined;
};

/**
 * Fallback mailing address when only an email is known.
 *
 * The letter template requires a non-empty `agencyFOIAAddress` for its header,
 * and an email-only contact is common. Using the agency name keeps the letter
 * well-formed and honest rather than blocking an otherwise-sendable request.
 */
const addressFallback = (opportunity: OpportunityDBItem): string | undefined =>
  trimmed(opportunity.organizationName);

export const resolveFoiaRecipient = async (args: {
  orgId: string;
  opportunity: OpportunityDBItem;
  /** Skip the document scan (used by dry runs and unit tests). */
  skipDocumentScan?: boolean;
}): Promise<ResolvedFoiaRecipient> => {
  const { orgId, opportunity, skipDocumentScan = false } = args;

  // ── Tier 1: an explicit FOIA-office override on the opportunity ──
  const overrideEmail = trimmed(opportunity.foiaContactEmail);
  if (overrideEmail) {
    return {
      email: overrideEmail,
      address: trimmed(opportunity.foiaContactAddress) ?? addressFallback(opportunity),
      name: trimmed(opportunity.foiaContactName),
      source: 'OPP_FOIA_OVERRIDE',
    };
  }

  // ── Tier 2: the point-of-contact the solicitation import already captured ──
  const contactEmail = trimmed(opportunity.contactEmail);
  if (contactEmail) {
    return {
      email: contactEmail,
      address: addressFallback(opportunity),
      name: trimmed(opportunity.contactName),
      source: 'OPP_CONTACT',
    };
  }

  // ── Tier 4 before tier 3: a saved directory entry is authoritative, and
  //    checking it first avoids an S3 scan we do not need. Tier 3 only ever
  //    produces candidates, so it cannot outrank a confirmed address anyway.
  const agencyName = trimmed(opportunity.organizationName);
  if (agencyName) {
    const contact = await getAgencyContact(orgId, agencyName);

    if (contact) {
      // A bounced or portal-only agency must not be emailed into a void.
      if (contact.acceptsEmail === false) {
        return {
          blockedReason: 'AGENCY_REQUIRES_PORTAL',
          address: trimmed(contact.foiaAddress) ?? addressFallback(opportunity),
          webPortalUrl: trimmed(contact.webPortalUrl),
          source: 'ORG_AGENCY_CONTACT',
        };
      }

      const directoryEmail = trimmed(contact.foiaEmail);
      if (directoryEmail) {
        return {
          email: directoryEmail,
          address: trimmed(contact.foiaAddress) ?? addressFallback(opportunity),
          source: 'ORG_AGENCY_CONTACT',
        };
      }
    }
  }

  // ── Tier 3: scan the solicitation text for candidates to confirm ──
  if (!skipDocumentScan && opportunity.projectId && opportunity.oppId) {
    const candidates = await scanSolicitationsForFoiaContact({
      projectId: opportunity.projectId,
      oppId: opportunity.oppId,
    });

    if (candidates.length > 0) {
      return {
        blockedReason: 'NEEDS_CONFIRMATION',
        candidates,
        address: addressFallback(opportunity),
      };
    }
  }

  return { blockedReason: 'NEEDS_RECIPIENT' };
};

/**
 * True when the resolution produced an address that may be used without asking.
 * Narrows the result so callers get a definite email.
 */
export const isSendableRecipient = (
  resolved: ResolvedFoiaRecipient,
): resolved is ResolvedFoiaRecipient & { email: string; source: FoiaRecipientSource } =>
  !resolved.blockedReason && typeof resolved.email === 'string' && resolved.email.length > 0;
