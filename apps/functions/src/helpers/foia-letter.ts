import { FOIA_DOCUMENT_DESCRIPTIONS, getStateRecordsLaw, type FOIADocumentType } from '@auto-rfp/core';

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
}

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

  // Build the "pertains to" line
  const pertainsLine = `This request pertains to Solicitation No. ${request.solicitationNumber}, titled ${request.contractTitle}, awarded on or about ${formatDateForLetter(request.awardDate)}.`;

  // Build the company/offeror paragraph
  const companyClause = `My company, ${request.companyName}, submitted a proposal`;
  const awardeeClause = request.awardeeName ? ` The contract was awarded to ${request.awardeeName}.` : '';

  // Fee limit line — always included
  const feeLine = request.feeLimit > 0
    ? `\nI am willing to pay up to $${request.feeLimit.toFixed(2)} in fees associated with this request. Please contact me before incurring any costs in excess of this amount.\n`
    : '\nI request a fee waiver for this request. If a fee waiver is not granted, please contact me before incurring any costs.\n';

  return `${today}

${recipientLine}
${request.agencyName}
${request.agencyFOIAAddress}
Email: ${request.agencyFOIAEmail}

${salutation}

${requestSentence}

${pertainsLine}

I am submitting this request on behalf of an unsuccessful offeror on the above-referenced solicitation. ${companyClause} in response to this solicitation and was not selected for award.${awardeeClause}

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
