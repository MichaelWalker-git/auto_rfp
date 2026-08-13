import { v4 as uuidv4 } from 'uuid';

import type {
  FoiaAwardDateProvenance,
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
import { getSubmissionHistory } from '@/helpers/proposal-submission';

/** An award date together with how much it can be trusted. */
export interface ResolvedAwardDate {
  date: string | undefined;
  provenance: FoiaAwardDateProvenance | undefined;
}

/**
 * Composes a FOIA request record without a human filling in a form.
 *
 * The manual flow asks a user for twelve required letter fields. For unattended
 * composition every one of them has to be derivable from data we already hold,
 * and anything that cannot be derived must surface as a precise block rather
 * than a half-filled letter. This module is that derivation, plus the
 * sendability precheck that decides between "ready" and "ask the user for X".
 */

/**
 * A composed FOIA request that has not been written yet, so has no table keys.
 *
 * Named explicitly because the distinction is load-bearing: seeding placeholder
 * keys to satisfy `DBFOIARequestItem` is what caused every automated preparation
 * to fail (the empty strings overwrote the real keys inside `putItem`). The key
 * names are literals rather than `typeof PK_NAME`, because `PK_NAME` is a `const`
 * of type `string` and `Omit<T, string>` strips nothing.
 */
export type UnkeyedFoiaRequest = Omit<DBFOIARequestItem, 'partition_key' | 'sort_key'>;

export interface DeriveFoiaRequestResult {
  /** Present when everything needed for a letter was derivable. */
  request?: UnkeyedFoiaRequest;
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
  /**
   * Whether a submission record proves this company bid on this solicitation.
   *
   * Threaded out so the letter can decide whether to claim bidder status. Not
   * stored on the request: it is evidence about the moment of composition, and
   * re-deriving it later could contradict the letter that was actually sent.
   */
  hasVerifiedSubmission?: boolean;
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
 * Picks the award date for the letter, and says where it came from.
 *
 * The provenance is the point. This used to return a bare string, which meant the
 * letter could not tell a recorded award from a forecast or a bid deadline — and it
 * asserted "awarded on or about <date>" either way. On a real Texas solicitation
 * that rendered "awarded on or about October 13, 2025" against a true award of
 * 2026-01-29: a factual claim in a statutory filing, 108 days wrong.
 *
 * Order is by evidential strength, not by which field is most often populated.
 * A recorded outcome outranks `decisionDateIso`, which the opportunity schema
 * defines as a *forecast* of when the agency will announce — the deadline-alert
 * scanner treats it as strictly future, so it is not evidence an award happened.
 * The response deadline is last and is only ever a floor.
 *
 * Callers must branch on provenance: a records request filed before award is
 * routinely denied as premature, so an unverified date must not be asserted as an
 * award and must not trigger an unattended send.
 */
export const resolveAwardDate = (opportunity: OpportunityDBItem): ResolvedAwardDate => {
  const candidates: ReadonlyArray<{
    value: string | undefined | null;
    provenance: FoiaAwardDateProvenance;
  }> = [
    // Recorded outcomes — an award (or loss) actually happened and was written down.
    { value: opportunity.winData?.awardDate, provenance: 'RECORDED_AWARD' },
    { value: opportunity.lossData?.lossDate, provenance: 'RECORDED_AWARD' },
    { value: opportunity.outcomeDate, provenance: 'RECORDED_OUTCOME' },
    // A forecast of the announcement date, not evidence of an announcement.
    { value: opportunity.decisionDateIso, provenance: 'FORECAST' },
    // When responses were due. Says nothing about whether an award followed.
    { value: opportunity.responseDeadlineIso, provenance: 'RESPONSE_DEADLINE' },
  ];

  for (const { value, provenance } of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      // The letter formatter accepts a bare YYYY-MM-DD as well as a full ISO
      // timestamp; normalizing to the date part keeps the rendered letter clean.
      return { date: value.slice(0, 10), provenance };
    }
  }

  return { date: undefined, provenance: undefined };
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

  const [organization, primaryContact, recipient, submissions] = await Promise.all([
    getOrganizationById(orgId).catch(() => null),
    getOrgPrimaryContact(orgId).catch(() => null),
    resolveFoiaRecipient({ orgId, opportunity, skipDocumentScan }),
    // Evidence for the letter's bidder-status claim. A lookup failure must read as
    // "unknown", never as "yes" — an unavailable table cannot be grounds for
    // asserting a fact about the customer's bidding history to an agency.
    getSubmissionHistory(orgId, projectId, oppId).catch(() => []),
  ]);

  /**
   * Whether we hold evidence this company actually bid.
   *
   * A withdrawn submission does not count: the letter claims a proposal was
   * submitted and not selected, which is not true of a bid that was pulled.
   */
  const hasVerifiedSubmission = submissions.some(
    (s) => typeof s?.submittedAt === 'string' && s.submittedAt.length > 0 && s.status !== 'WITHDRAWN',
  );

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
  const awardDate = resolveAwardDate(opportunity);

  /**
   * A derived request has no DynamoDB keys yet — they belong to whoever writes it.
   *
   * This was previously typed as `DBFOIARequestItem` and seeded with
   * `partition_key: ''` / `sort_key: ''` purely to satisfy that type. Those empty
   * strings then travelled with the object into `putItem`, whose spread order
   * (`{ [PK_NAME]: pk, [SK_NAME]: sk, ...item }`) let them overwrite the correct
   * key arguments, so every automated preparation failed with "The AttributeValue
   * for a key attribute cannot contain an empty string value."
   *
   * Typing it as `Omit<..., 'partition_key' | 'sort_key'>` with literal names is
   * both honest and load-bearing: the compiler now rejects any attempt to
   * reintroduce a placeholder key. Note that `Omit<T, typeof PK_NAME>` would NOT
   * work — `PK_NAME` is declared as a plain `const` of type `string`, so that
   * resolves to `Omit<T, string>`, which strips nothing.
   */
  const request: UnkeyedFoiaRequest = {
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
    awardDate: awardDate.date ?? '',
    awardDateProvenance: awardDate.provenance,

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

  return { request, recipientSource: recipient.source, hasVerifiedSubmission };
};
