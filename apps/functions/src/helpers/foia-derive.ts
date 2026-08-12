import { v4 as uuidv4 } from 'uuid';

import type {
  FoiaBlockedReason,
  FoiaRecipientCandidate,
  FoiaRecipientSource,
  FoiaSettingsItem,
  OpportunityDBItem,
} from '@auto-rfp/core';

import type { DBFOIARequestItem } from '@/types/project-outcome';
import { nowIso } from '@/helpers/date';
import { getOrganizationById } from '@/helpers/org';
import { getOrgPrimaryContact } from '@/helpers/org-contact';
import { validateLetterFields } from '@/helpers/foia-letter';
import { resolveFoiaRecipient } from '@/helpers/foia-recipient';

/**
 * Composes a FOIA request record without a human filling in a form.
 *
 * The manual flow asks a user for twelve required letter fields. For unattended
 * composition every one of them has to be derivable from data we already hold,
 * and anything that cannot be derived must surface as a precise block rather
 * than a half-filled letter. This module is that derivation, plus the
 * sendability precheck that decides between "ready" and "ask the user for X".
 */

export interface DeriveFoiaRequestResult {
  /** Present when everything needed for a letter was derivable. */
  request?: DBFOIARequestItem;
  /** Set when the request cannot proceed without human input. */
  blockedReason?: FoiaBlockedReason;
  /** Populated for MISSING_LETTER_FIELDS. */
  missingFields?: string[];
  /** Populated for NEEDS_CONFIRMATION — candidates for a human to pick from. */
  recipientCandidates?: FoiaRecipientCandidate[];
  /** Which resolution tier supplied the agency address. */
  recipientSource?: FoiaRecipientSource;
  /** Portal URL to show when the agency refuses email. */
  webPortalUrl?: string;
}

/**
 * Renders the requester's company as an agency will need to search for it.
 *
 * Returns "<legal> dba <trading>" when the two differ — the form a California
 * agency itself used when replying — and the single name otherwise. Never
 * duplicates a name that is the same in both fields, and tolerates either being
 * absent, since `legalName` is optional and most organizations trade under their
 * registered name.
 */
export const buildCompanyName = (
  tradingName: string | undefined,
  legalName: string | undefined,
): string => {
  const trading = tradingName?.trim() ?? '';
  const legal = legalName?.trim() ?? '';

  if (!legal) return trading;
  if (!trading) return legal;
  if (legal.toLowerCase() === trading.toLowerCase()) return trading;

  return `${legal} dba ${trading}`;
};

/**
 * Picks the award date for the letter.
 *
 * Preference order matters legally: a records request filed before award is
 * routinely denied as premature, so we use the most authoritative date we have.
 * The letter template already hedges with "on or about", which keeps the wording
 * honest when the date is inferred from the response deadline.
 */
export const resolveAwardDate = (opportunity: OpportunityDBItem): string | undefined => {
  const candidates = [
    opportunity.decisionDateIso,
    opportunity.winData?.awardDate,
    opportunity.lossData?.lossDate,
    opportunity.outcomeDate,
    opportunity.responseDeadlineIso,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      // The letter formatter accepts a bare YYYY-MM-DD as well as a full ISO
      // timestamp; normalizing to the date part keeps the rendered letter clean.
      return candidate.slice(0, 10);
    }
  }

  return undefined;
};

/**
 * Derives a complete FOIA request for an opportunity, or explains why it cannot.
 *
 * Requester identity comes from the org primary contact — the same signatory the
 * manual flow uses to prefill the form (see `enrichWithPrimaryContact` in
 * handlers/foia/generate-foia-letter.ts).
 */
export const deriveFoiaRequest = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  opportunity: OpportunityDBItem;
  settings: FoiaSettingsItem;
  /** Skip the solicitation text scan (dry runs and tests). */
  skipDocumentScan?: boolean;
}): Promise<DeriveFoiaRequestResult> => {
  const { orgId, projectId, oppId, opportunity, settings, skipDocumentScan } = args;

  const [organization, primaryContact, recipient] = await Promise.all([
    getOrganizationById(orgId).catch(() => null),
    getOrgPrimaryContact(orgId).catch(() => null),
    resolveFoiaRecipient({ orgId, opportunity, skipDocumentScan }),
  ]);

  // A recipient we cannot use is the most common block, and it is actionable —
  // surface it before worrying about any other missing field.
  if (recipient.blockedReason) {
    return {
      blockedReason: recipient.blockedReason,
      recipientCandidates: recipient.candidates,
      webPortalUrl: recipient.webPortalUrl,
    };
  }

  const now = nowIso();
  const foiaId = uuidv4();

  const request: DBFOIARequestItem = {
    partition_key: '',
    sort_key: '',
    foiaId,
    id: foiaId,
    orgId,
    projectId,
    opportunityId: oppId,

    // Agency — from the resolver.
    agencyName: opportunity.organizationName ?? '',
    agencyFOIAEmail: recipient.email ?? '',
    agencyFOIAAddress: recipient.address ?? '',

    // Contract identity — straight off the opportunity.
    solicitationNumber: opportunity.solicitationNumber ?? '',
    contractTitle: opportunity.title ?? '',

    requestedDocuments: settings.defaultRequestedDocuments,
    customDocumentRequests: [],
    feeLimit: settings.defaultFeeLimit,

    // Our side of the request.
    //
    // Names both the legal entity and the trading name when they differ, because
    // the agency indexes the procurement file under whatever the bid was filed
    // as. Real responses for one company show "Interesting Interests dba Horus
    // Technology", "Interesting Interests Inc." and "Horus Technology" all in
    // use; asking under only one risks a "no record located" reply that reflects
    // the search string rather than the facts.
    companyName: buildCompanyName(organization?.name, organization?.legalName),
    // Only meaningful on a loss — on a win we are the awardee, and naming
    // ourselves in the letter's "awarded to" clause would read as nonsense.
    awardeeName: opportunity.lossData?.winningContractor ?? undefined,
    awardDate: resolveAwardDate(opportunity) ?? '',

    // Requester — the org's proposal signatory.
    requesterName: primaryContact?.name ?? '',
    requesterTitle: primaryContact?.title ?? '',
    requesterEmail: primaryContact?.email ?? '',
    requesterPhone: primaryContact?.phone ?? '',
    requesterAddress: primaryContact?.address ?? '',

    requestedBy: 'system',
    createdBy: 'system',
    createdAt: now,
    updatedAt: now,

    origin: 'AUTOMATED',
    recipientSource: recipient.source,
  };

  const missingFields = validateLetterFields(request);
  if (missingFields.length > 0) {
    return { blockedReason: 'MISSING_LETTER_FIELDS', missingFields };
  }

  return { request, recipientSource: recipient.source };
};
