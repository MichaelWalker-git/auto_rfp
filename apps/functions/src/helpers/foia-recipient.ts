import type {
  FoiaBlockedReason,
  FoiaRecipientCandidate,
  FoiaRecipientSource,
  FoiaSubmissionMethod,
  OpportunityDBItem,
} from '@auto-rfp/core';
import {
  formatFoiaComponentAddress,
  getFoiaComponentEmail,
  isTrustedFoiaRecipientSource,
  resolveFoiaSubmissionMethod,
} from '@auto-rfp/core';

import { getAgencyContact } from '@/helpers/foia-agency-contact';
import { getFoiaComponent, matchStoredFoiaComponent } from '@/helpers/foia-component';
import { scanSolicitationsForFoiaContact } from '@/helpers/foia-doc-scan';
import { orderHierarchyForMatching, resolveAgencyHierarchy } from '@/helpers/highergov-agency';
import type { HigherGovConfig } from '@/helpers/highergov';

/**
 * Resolves where an automatic FOIA request should be sent.
 *
 * There is no standard for how a solicitation names its records contact, so the
 * resolver tries several sources in priority order and records which one won,
 * along with whether that source is trustworthy enough to send unattended.
 *
 * Tier order:
 *   1. `opportunity.foiaContactEmail`  — explicit FOIA-office override  TRUSTED
 *   2. the org's agency-contact directory — confirmed previously        TRUSTED
 *   3. FOIA.gov component match (exact; optionally via a HigherGov
 *      hierarchy walk for leaf offices)                                TRUSTED
 *   4. `opportunity.contactEmail` — the contracting officer          UNTRUSTED
 *   5. solicitation document text scan — candidates to confirm       UNTRUSTED
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
  /** The FOIA.gov component this resolved to, when it came from the directory. */
  foiaComponentId?: string;
  /** How this agency expects to receive requests. */
  submissionMethod?: FoiaSubmissionMethod;
  /**
   * Whether the address may be transmitted without a human clicking approve.
   * Derived from `source` — see `isTrustedFoiaRecipientSource`.
   */
  isTrusted?: boolean;
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

/** Stamps `isTrusted` from the source so callers cannot forget to. */
const withTrust = (resolved: ResolvedFoiaRecipient): ResolvedFoiaRecipient => ({
  ...resolved,
  isTrusted: isTrustedFoiaRecipientSource(resolved.source),
});

/**
 * Tier 3: the mirrored FOIA.gov directory.
 *
 * Tries the stored agency name directly, then — for a HigherGov leaf office like
 * "NPS Midwest Region", which is not itself a FOIA component — walks that
 * agency's hierarchy most-specific-first and matches each rung.
 */
const resolveFromFoiaGov = async (args: {
  opportunity: OpportunityDBItem;
  higherGovConfig?: HigherGovConfig;
}): Promise<ResolvedFoiaRecipient | null> => {
  const { opportunity, higherGovConfig } = args;

  const agencyName = trimmed(opportunity.organizationName);
  if (!agencyName) return null;

  let match = await matchStoredFoiaComponent(agencyName);
  let source: FoiaRecipientSource = 'FOIA_GOV';

  // A leaf office will not match; its parent department will.
  if (!match.matched && higherGovConfig && opportunity.higherGovAgencyKey) {
    const hierarchy = await resolveAgencyHierarchy(
      higherGovConfig,
      opportunity.higherGovAgencyKey,
    );

    if (hierarchy) {
      match = await matchStoredFoiaComponent(undefined, orderHierarchyForMatching(hierarchy.levels));
      source = 'HIGHERGOV_HIERARCHY';
    }
  }

  if (!match.matched) {
    // An ambiguous key is a definitive refusal; the picker resolves it.
    return match.refusal === 'ABBREVIATION_AMBIGUOUS' || match.refusal === 'TITLE_AMBIGUOUS'
      ? { blockedReason: 'NEEDS_AGENCY_MATCH', address: addressFallback(opportunity) }
      : null;
  }

  const component = await getFoiaComponent(match.componentId);
  if (!component) return null;

  const email = getFoiaComponentEmail(component);
  const address =
    formatFoiaComponentAddress(component.submissionAddress) ?? addressFallback(opportunity);
  const submissionMethod = resolveFoiaSubmissionMethod(component);

  // No mailbox means no unattended send is possible — hand the finished letter to
  // a human with the portal or postal address instead of emailing into a void.
  if (!email) {
    return {
      blockedReason: 'AGENCY_REQUIRES_PORTAL',
      address,
      webPortalUrl: trimmed(component.submissionWebUrl),
      foiaComponentId: component.componentId,
      submissionMethod,
      source,
    };
  }

  return { email, address, source, foiaComponentId: component.componentId, submissionMethod };
};

export const resolveFoiaRecipient = async (args: {
  orgId: string;
  opportunity: OpportunityDBItem;
  /** Skip the document scan (used by dry runs and unit tests). */
  skipDocumentScan?: boolean;
  /** Enables the HigherGov hierarchy walk for leaf offices. */
  higherGovConfig?: HigherGovConfig;
}): Promise<ResolvedFoiaRecipient> => {
  const { orgId, opportunity, skipDocumentScan = false, higherGovConfig } = args;

  // ── Tier 1: an explicit FOIA-office override on the opportunity ──
  const overrideEmail = trimmed(opportunity.foiaContactEmail);
  if (overrideEmail) {
    return withTrust({
      email: overrideEmail,
      address: trimmed(opportunity.foiaContactAddress) ?? addressFallback(opportunity),
      name: trimmed(opportunity.foiaContactName),
      source: 'OPP_FOIA_OVERRIDE',
    });
  }

  // ── Tier 2: an address a human already confirmed for this agency ──
  const agencyName = trimmed(opportunity.organizationName);
  if (agencyName) {
    const contact = await getAgencyContact(orgId, agencyName);

    if (contact) {
      // A bounced or portal-only agency must not be emailed into a void.
      if (contact.acceptsEmail === false) {
        return withTrust({
          blockedReason: 'AGENCY_REQUIRES_PORTAL',
          address: trimmed(contact.foiaAddress) ?? addressFallback(opportunity),
          webPortalUrl: trimmed(contact.webPortalUrl),
          source: 'ORG_AGENCY_CONTACT',
        });
      }

      const directoryEmail = trimmed(contact.foiaEmail);
      if (directoryEmail) {
        return withTrust({
          email: directoryEmail,
          address: trimmed(contact.foiaAddress) ?? addressFallback(opportunity),
          source: 'ORG_AGENCY_CONTACT',
        });
      }
    }
  }

  // ── Tier 3: the government's own published directory ──
  const fromFoiaGov = await resolveFromFoiaGov({ opportunity, higherGovConfig });
  if (fromFoiaGov) return withTrust(fromFoiaGov);

  // ── Tier 4: the contracting officer from the feed.
  //
  // Untrusted on purpose: the CO is usually not the FOIA office. Useful as a
  // fallback a human reviews, wrong to mail unattended.
  const contactEmail = trimmed(opportunity.contactEmail);
  if (contactEmail) {
    return withTrust({
      email: contactEmail,
      address: addressFallback(opportunity),
      name: trimmed(opportunity.contactName),
      source: 'OPP_CONTACT',
    });
  }

  // ── Tier 5: scan the solicitation text for candidates to confirm ──
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
        isTrusted: false,
      };
    }
  }

  return { blockedReason: 'NEEDS_RECIPIENT', isTrusted: false };
};

/**
 * True when the resolution produced an address that may be used without asking.
 * Narrows the result so callers get a definite email.
 */
export const isSendableRecipient = (
  resolved: ResolvedFoiaRecipient,
): resolved is ResolvedFoiaRecipient & { email: string; source: FoiaRecipientSource } =>
  !resolved.blockedReason && typeof resolved.email === 'string' && resolved.email.length > 0;
