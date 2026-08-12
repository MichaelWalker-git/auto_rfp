import {
  FOIA_DOCUMENT_DESCRIPTIONS,
  getStateRecordsLaw,
  isVerifiedAwardDateProvenance,
  type FOIADocumentType,
} from '@auto-rfp/core';

import type { DBFOIARequestItem } from '@/types/project-outcome';

/**
 * Public-records request letter generation.
 *
 * Extracted verbatim from handlers/foia/generate-foia-letter.ts so the scheduled
 * reconciler and the send path can compose a letter without going through an API
 * Gateway handler. The handler now re-exports these, so its existing tests and
 * the `POST /foia/generate-foia-letter` contract are unchanged.
 */

/** Fields on the FOIA request record that must be populated to generate a letter. */
export const REQUIRED_LETTER_FIELDS = [
  'agencyName',
  'agencyFOIAEmail',
  'agencyFOIAAddress',
  'solicitationNumber',
  'contractTitle',
  'awardDate',
  'companyName',
  'requesterName',
  'requesterTitle',
  'requesterEmail',
  'requesterPhone',
  'requesterAddress',
] as const;

/**
 * Returns the names of any fields still missing for letter generation.
 * An empty array means the request is ready to render.
 */
export const validateLetterFields = (request: DBFOIARequestItem): string[] => {
  const missing: string[] = [];
  for (const field of REQUIRED_LETTER_FIELDS) {
    if (!request[field]) {
      missing.push(field);
    }
  }
  // requestedDocuments must have at least one entry
  if (!request.requestedDocuments || request.requestedDocuments.length === 0) {
    missing.push('requestedDocuments');
  }
  return missing;
};

/** Context that controls which records law the letter is framed under. */
export interface LetterJurisdictionContext {
  jurisdiction?: 'FEDERAL' | 'STATE';
  state?: string;
  /**
   * Whether we hold a submission record proving this company bid on this
   * solicitation.
   *
   * This governs a factual assertion in a statutory filing, so it is passed in
   * explicitly rather than assumed. Both outcomes are real: on one Texas
   * solicitation the agency replied "no record of Horus Technology's
   * participation in this solicitation was located" — the letter had claimed to
   * be from a proposer — while on a California IFB the abstract of bids lists
   * the company as bidder 3 of 3. A single hardcoded sentence is wrong roughly
   * half the time, and it is wrong in the direction of misrepresenting the
   * requester to a government agency.
   *
   * Undefined means unknown, which is treated the same as false: claim nothing.
   */
  hasVerifiedSubmission?: boolean;
}

/**
 * The paragraph establishing who is asking and why.
 *
 * Under the federal FOIA and every state records act, *any person* may request
 * records — standing as a disappointed bidder is never required to obtain them.
 * So the unverifiable version of this claim buys nothing and risks everything:
 * an automated system asserting it at scale would misstate the requester's
 * bidding history to an agency, in the customer's name, without anyone reading
 * it first.
 *
 * When a submission is on record we say so, because it is true and it helps the
 * agency locate the file. When it is not, we state the interest we can actually
 * substantiate — that the requester is a prospective contractor seeking the
 * procurement record — and let the statute supply the entitlement.
 */
const resolveInterestParagraph = (args: {
  companyName: string;
  hasVerifiedSubmission?: boolean;
}): string =>
  args.hasVerifiedSubmission
    ? `My company, ${args.companyName}, submitted a proposal in response to the above-referenced solicitation and was not selected for award.`
    : `My company, ${args.companyName}, is a prospective contractor with a commercial interest in the conduct and outcome of this procurement. This request is made under the statutory right of any person to obtain public records; no claim of bidder status is asserted.`;

/**
 * Formats a date string into a human-readable format for letters.
 * Handles both ISO dates ("2026-01-15") and already-formatted strings ("January 15, 2026").
 */
const formatDateForLetter = (dateStr: string): string => {
  // If it's an ISO date (YYYY-MM-DD), parse with explicit UTC to avoid timezone shift
  const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const utc = new Date(Date.UTC(+isoMatch[1]!, +isoMatch[2]! - 1, +isoMatch[3]!));
    return utc.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }
  // Already human-readable (e.g. "January 15, 2026") — return as-is
  return dateStr;
};

/**
 * Resolves the salutation, statute reference, and request-type wording for a
 * letter based on the contract's jurisdiction.
 * - FEDERAL (or unset): federal Freedom of Information Act (5 U.S.C. § 552).
 * - STATE: the named state public-records law (e.g. "California Public Records Act (CPRA)").
 */
const resolveLetterFraming = (
  ctx: LetterJurisdictionContext,
): { recipientLine: string; salutation: string; requestSentence: string } => {
  const stateLaw = ctx.jurisdiction === 'STATE' && ctx.state ? getStateRecordsLaw(ctx.state) : undefined;

  if (stateLaw) {
    return {
      recipientLine: 'Public Records Officer',
      salutation: 'Dear Records Custodian,',
      requestSentence: `This is a request under the ${stateLaw}.`,
    };
  }

  return {
    recipientLine: 'FOIA Requester Service Center',
    salutation: 'Dear FOIA Officer,',
    requestSentence: 'This is a request under the Freedom of Information Act (5 U.S.C. Section 552).',
  };
};

/**
 * Generates a simplified, practitioner-oriented public records request letter.
 * Defaults to federal FOIA framing when no jurisdiction context is provided.
 */
export const generateFOIALetter = (
  request: DBFOIARequestItem,
  jurisdictionContext: LetterJurisdictionContext = {},
): string => {
  const { recipientLine, salutation, requestSentence } = resolveLetterFraming(jurisdictionContext);
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const numberedDocuments = request.requestedDocuments
    .map((doc: FOIADocumentType, idx: number) => `   ${idx + 1}. ${FOIA_DOCUMENT_DESCRIPTIONS[doc]}`)
    .join('\n');

  const customDocuments = request.customDocumentRequests?.length
    ? request.customDocumentRequests
        .map((desc: string, idx: number) => `   ${request.requestedDocuments.length + idx + 1}. ${desc}`)
        .join('\n')
    : '';

  const allDocuments = customDocuments
    ? `${numberedDocuments}\n${customDocuments}`
    : numberedDocuments;

  /**
   * Whether the letter may state that an award happened.
   *
   * "on or about" hedges a date, not a fact. When the date came from the response
   * deadline the letter would assert an award that may not exist yet — on one real
   * solicitation that produced "awarded on or about October 13, 2025" against a
   * true award of 2026-01-29, 108 days later. So an unverified date is described as
   * what it actually is (when responses were due) and the request is written to
   * cover either outcome, which also keeps it valid if the solicitation is still
   * pending or was cancelled.
   */
  const pertainsLine = isVerifiedAwardDateProvenance(request.awardDateProvenance)
    ? `This request pertains to Solicitation No. ${request.solicitationNumber}, titled ${request.contractTitle}, awarded on or about ${formatDateForLetter(request.awardDate)}.`
    : `This request pertains to Solicitation No. ${request.solicitationNumber}, titled ${request.contractTitle}, for which responses were due ${formatDateForLetter(request.awardDate)}. If an award has been made, this request extends to the records of that award; if the solicitation remains pending or was cancelled, please advise and treat this request as limited to the records that exist as of the date of your response.`;

  const interestParagraph = resolveInterestParagraph({
    companyName: request.companyName,
    hasVerifiedSubmission: jurisdictionContext.hasVerifiedSubmission,
  });

  const awardeeClause = request.awardeeName ? ` The contract was awarded to ${request.awardeeName}.` : '';

  /**
   * Fees.
   *
   * The previous default asked for a *waiver*, which a commercial requester is
   * generally not entitled to — a fee waiver turns on public interest, not on
   * wanting the records. Asserting entitlement to one weakens the letter and
   * invites a denial on fee grounds before anyone reads the substance.
   *
   * Asking for a written cost estimate first is both accurate and what the
   * statutes contemplate, and it is what the practitioner's own successful
   * letter did. Both real agencies then waived duplication costs unprompted.
   */
  const feeLine = request.feeLimit > 0
    ? `\nI will pay reasonable charges for responsive records up to $${request.feeLimit.toFixed(2)}. Please provide a written cost estimate before incurring any costs in excess of that amount.\n`
    : '\nI will pay reasonable statutory charges for responsive records. Please provide a written cost estimate before incurring any costs.\n';

  return `${today}

${recipientLine}
${request.agencyName}
${request.agencyFOIAAddress}
Email: ${request.agencyFOIAEmail}

${salutation}

${requestSentence}

${pertainsLine}

${interestParagraph}${awardeeClause}

I request that a copy of the following documents be provided to me:

${allDocuments}
${feeLine}
I request that responsive records be provided in electronic format (PDF preferred) via email to ${request.requesterEmail}.

Sincerely,

${request.requesterName}
${request.requesterTitle}
${request.companyName}
${request.requesterAddress}
Email: ${request.requesterEmail}
Phone: ${request.requesterPhone}`;
};
