import type { FoiaRecipientCandidate, QuestionFileItem } from '@auto-rfp/core';

import { loadTextFromS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import { listQuestionFilesByOpportunity } from '@/helpers/questionFile';

/**
 * Tier 3 of the FOIA recipient fallback chain: find candidate FOIA addresses in
 * the solicitation's own text.
 *
 * There is no standard for where a solicitation names its records contact, so
 * this scans the text that has ALREADY been extracted for question parsing
 * (`questionFile.textFileKey`) rather than re-processing any documents.
 *
 * Candidates are never used automatically. The scan returns a ranked shortlist
 * for a human to confirm, because a regex match is evidence, not authority — and
 * the recipient of a statutory records request has to be right.
 */

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

/** Only government addresses are plausible recipients for a records request. */
const GOV_EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]*\.(?:gov|mil|us)\b/gi;

/** Characters of surrounding text captured on each side of a match. */
const CONTEXT_RADIUS = 120;

/** How far from a keyword a match still counts as "near" it. */
const PROXIMITY_WINDOW = 200;

/**
 * Keywords that suggest an address belongs to a records office, weighted by how
 * strongly they imply it. A FOIA-office mention is far more meaningful than a
 * generic contracting reference.
 */
const KEYWORD_WEIGHTS: ReadonlyArray<{ pattern: RegExp; weight: number }> = [
  { pattern: /\bFOIA\s+(?:officer|office|contact|coordinator|requester\s+service\s+cent(?:er|re))\b/gi, weight: 10 },
  { pattern: /\bfreedom\s+of\s+information\b/gi, weight: 8 },
  { pattern: /\bFOIA\b/gi, weight: 6 },
  { pattern: /\bpublic\s+records?\s+(?:officer|office|request|custodian)\b/gi, weight: 8 },
  { pattern: /\brecords?\s+custodian\b/gi, weight: 7 },
  { pattern: /\bopen\s+records?\b/gi, weight: 6 },
  { pattern: /\bcontracting\s+officer\b/gi, weight: 3 },
  { pattern: /\bcontract\s+specialist\b/gi, weight: 2 },
  { pattern: /\bpoint\s+of\s+contact\b/gi, weight: 1 },
];

/** Addresses that are never a records contact, however they score. */
const EXCLUDED_PATTERNS: ReadonlyArray<RegExp> = [
  /^no-?reply@/i,
  /^do-?not-?reply@/i,
  /^postmaster@/i,
  /^webmaster@/i,
  /@sam\.gov$/i,
  /@fbo\.gov$/i,
];

/** Maximum candidates returned for confirmation. More is noise, not help. */
const MAX_CANDIDATES = 3;

interface KeywordHit {
  index: number;
  weight: number;
}

/** Collects every keyword occurrence with its offset, so proximity can be scored. */
const findKeywordHits = (text: string): KeywordHit[] => {
  const hits: KeywordHit[] = [];

  for (const { pattern, weight } of KEYWORD_WEIGHTS) {
    // Each pattern carries /g, so reset lastIndex before reuse across calls.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      hits.push({ index: match.index, weight });
      // Guard against a zero-length match spinning forever.
      if (match.index === pattern.lastIndex) pattern.lastIndex += 1;
    }
  }

  return hits;
};

const isExcluded = (email: string): boolean =>
  EXCLUDED_PATTERNS.some((pattern) => pattern.test(email));

/**
 * Scores candidate addresses found in one document's text.
 *
 * An address scores by the weight of the keywords near it, so a `.gov` address
 * sitting beside "FOIA Officer" outranks one beside "point of contact", and an
 * address with no nearby keyword at all scores zero and is dropped.
 *
 * Exported separately from the S3 plumbing so it can be unit-tested against
 * fixture text.
 */
export const scoreFoiaEmailCandidates = (
  text: string,
  sourceFileName?: string,
): FoiaRecipientCandidate[] => {
  if (!text) return [];

  const keywordHits = findKeywordHits(text);
  if (keywordHits.length === 0) return [];

  /** Best score and context per unique lowercased address. */
  const byEmail = new Map<string, FoiaRecipientCandidate>();

  GOV_EMAIL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = GOV_EMAIL_REGEX.exec(text)) !== null) {
    const email = match[0];
    const normalized = email.toLowerCase();

    if (isExcluded(normalized)) continue;

    // Sum nearby keyword weights, decayed by distance.
    //
    // The decay is load-bearing, not cosmetic: without it an address sitting
    // just before a section boundary inherits full credit for the NEXT
    // section's keywords, so a contracting-officer address immediately
    // preceding a "Freedom of Information Act" heading would outrank the FOIA
    // address inside that section. Weighting by proximity makes the keyword
    // an address actually sits beside dominate.
    let score = 0;
    for (const hit of keywordHits) {
      const distance = Math.abs(hit.index - match.index);
      if (distance > PROXIMITY_WINDOW) continue;
      score += hit.weight * (1 - distance / PROXIMITY_WINDOW);
    }

    // Round to keep scores readable in the UI and stable in assertions.
    score = Math.round(score * 100) / 100;

    if (score <= 0) continue;

    const start = Math.max(0, match.index - CONTEXT_RADIUS);
    const end = Math.min(text.length, match.index + email.length + CONTEXT_RADIUS);
    const context = text.slice(start, end).replace(/\s+/g, ' ').trim();

    const existing = byEmail.get(normalized);
    if (!existing || score > existing.score) {
      byEmail.set(normalized, {
        email: normalized,
        context: context.slice(0, 500),
        score,
        ...(sourceFileName ? { sourceFileName } : {}),
      });
    }
  }

  return [...byEmail.values()].sort((a, b) => b.score - a.score);
};

/**
 * Merges per-document candidate lists, keeping the best score for each address.
 */
export const mergeCandidates = (
  lists: ReadonlyArray<readonly FoiaRecipientCandidate[]>,
): FoiaRecipientCandidate[] => {
  const byEmail = new Map<string, FoiaRecipientCandidate>();

  for (const list of lists) {
    for (const candidate of list) {
      const existing = byEmail.get(candidate.email);
      if (!existing || candidate.score > existing.score) {
        byEmail.set(candidate.email, candidate);
      }
    }
  }

  return [...byEmail.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES);
};

/**
 * Scans an opportunity's solicitation documents for candidate FOIA addresses.
 *
 * Best-effort by design: a document whose text cannot be read is skipped with a
 * warning rather than failing the scan, because a partial shortlist is still
 * useful and this runs inside the nightly reconciler.
 */
export const scanSolicitationsForFoiaContact = async (args: {
  projectId: string;
  oppId: string;
}): Promise<FoiaRecipientCandidate[]> => {
  const { projectId, oppId } = args;

  const { items } = await listQuestionFilesByOpportunity({ projectId, oppId });
  const files = items as QuestionFileItem[];

  const withText = files.filter((file): file is QuestionFileItem & { textFileKey: string } =>
    typeof file.textFileKey === 'string' && file.textFileKey.length > 0,
  );

  if (withText.length === 0) return [];

  const perDocument = await Promise.all(
    withText.map(async (file) => {
      try {
        const text = await loadTextFromS3(DOCUMENTS_BUCKET, file.textFileKey);
        return scoreFoiaEmailCandidates(text, file.originalFileName);
      } catch (err) {
        console.warn(
          `[foia-doc-scan] Could not read text for ${file.textFileKey}:`,
          err instanceof Error ? err.message : String(err),
        );
        return [];
      }
    }),
  );

  return mergeCandidates(perDocument);
};
