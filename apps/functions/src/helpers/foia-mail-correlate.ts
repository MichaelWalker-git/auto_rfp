/**
 * Correlates an inbound message to one of our own opportunities.
 *
 * The direction here is deliberate and was arrived at the hard way. The obvious
 * approach — pattern-match a solicitation number out of the email — was measured
 * against every solicitation number in the live dev table and matched 11 of 360
 * (3%). Federal numbers are structured (W912DY-24-R-0001), but real pipelines are
 * mostly state, county, university and school-district work, where the formats
 * have nothing in common: "739-SL3722874", "26COR-072", "RFP194982", "C25910004",
 * "RFP No. 26-16". No regex covers that set, and a regex loose enough to try would
 * match arbitrary invoice and PO numbers.
 *
 * So we search the other way round: take the solicitation numbers we already hold
 * and look for them IN the message. Recall becomes a property of our own data
 * rather than of a guess about agency formatting — 81% of real records are usable,
 * and a correlation can only ever point at an opportunity that exists.
 */

/**
 * Label noise agencies put in front of the actual number. Stripped repeatedly,
 * because real values stack them: "GEN No. RFP No. 26-16".
 */
const LABEL_PREFIX =
  /^(?:RFP|RFQ|RFI|IFB|ITB|BID|SOLICITATION|SOL|CONTRACT|PROJECT|GEN|NO|NUMBER|#)\b[\s.:#-]*/i;

/** Values that occupy the field but identify nothing. */
const PLACEHOLDER = /^(?:N\/?A|NONE|TBD|UNKNOWN|PENDING|ABC-?123|TEST\w*|SOL-\d+)$/i;

/** Machine-generated ids from bulk upload — never appear in agency mail. */
const SYNTHETIC_PREFIX = /^BATCH-/i;

/**
 * Stored values that are calendar dates rather than identifiers.
 *
 * Two real opportunities hold "2026-08" and "2025-02" in `solicitationNumber`. A
 * bare year-month is not an identifier, and it is actively dangerous as one: it
 * appears inside every ISO date in that month, so it correlates arbitrary mail.
 * "2026-08" matched a GSA helpdesk ticket ("If we do not receive a response
 * 2026-08-20 ...") and would equally match an award notice's "Award Date
 * 2026-08-04" — attaching it to whichever unrelated opportunity holds the value.
 *
 * Deliberately narrow: anchored, with a real month (and day) range, so genuine
 * short numbers keep working. Verified against all 479 stored numbers — this
 * rejects exactly the two date-shaped values and none of the legitimate
 * fiscal-year forms like "26-43", "78-26", "RFP No. 26-22" or "RFP 07-26", whose
 * second segment is a sequence number rather than a month.
 */
const DATE_SHAPED = /^(?:19|20)\d{2}[-/](?:0[1-9]|1[0-2])(?:[-/](?:0[1-9]|[12]\d|3[01]))?$/;

/**
 * Below this many alphanumeric characters, a normalized substring search is
 * unsafe: "4713" occurs inside "44713", and "26.10" inside "26.104". Short
 * numbers fall back to boundary-anchored matching on their literal form.
 */
const MIN_SUBSTRING_LENGTH = 7;

/** Strips leading label noise to leave the identifier itself. */
export const coreSolicitationNumber = (value: string): string => {
  let s = (value ?? '').trim();
  let previous = '';
  while (previous !== s) {
    previous = s;
    s = s.replace(LABEL_PREFIX, '').trim();
  }
  return s;
};

/**
 * Reduces to comparable form. Agencies re-punctuate freely — the same
 * solicitation appears as "36C24826Q0460" and "36C248-26-Q-0460" — so
 * punctuation and case are discarded for comparison.
 */
const comparable = (value: string): string =>
  (value ?? '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/** Whether a stored solicitation number can be correlated on at all. */
export const isCorrelatableSolicitationNumber = (value: string | undefined | null): boolean => {
  if (!value) return false;
  const trimmed = value.trim();
  if (SYNTHETIC_PREFIX.test(trimmed)) return false;
  if (PLACEHOLDER.test(trimmed)) return false;

  const core = coreSolicitationNumber(trimmed);
  if (DATE_SHAPED.test(core)) return false;

  return comparable(core).length >= 4;
};

/** An opportunity the correlator may consider. */
export interface CorrelationCandidate {
  oppId: string;
  orgId: string;
  projectId: string;
  solicitationNumber?: string;
  title?: string;
}

export interface CorrelationMatch {
  candidate: CorrelationCandidate;
  /** The stored number that matched. */
  matchedNumber: string;
  /** How it matched, for the activity log. */
  matchedBy: 'NORMALIZED_SUBSTRING' | 'LITERAL_BOUNDARY';
}

/**
 * Boundary-anchored literal search, for identifiers too short to be safe as a
 * normalized substring. Requires a non-alphanumeric neighbour on each side, so
 * "4713" matches "PO 4713." but not "44713".
 */
const matchesLiterally = (needle: string, haystack: string): boolean => {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(haystack);
};

/**
 * Finds every opportunity whose solicitation number appears in the message.
 *
 * Returns all matches rather than picking one. More than one match means the
 * message is genuinely ambiguous — an amendment covering several solicitations,
 * or two opportunities sharing a number across orgs — and the caller must not
 * act on it unattended. Silently taking the first would attach an award notice
 * to the wrong opportunity and file a request against the wrong agency.
 */
export const correlateMailToOpportunities = (
  mailText: string,
  candidates: readonly CorrelationCandidate[],
): CorrelationMatch[] => {
  const haystackComparable = comparable(mailText);
  const matches: CorrelationMatch[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const stored = candidate.solicitationNumber;
    if (!isCorrelatableSolicitationNumber(stored)) continue;

    const core = coreSolicitationNumber(stored as string);
    const normalized = comparable(core);

    const matchedBy =
      normalized.length >= MIN_SUBSTRING_LENGTH && haystackComparable.includes(normalized)
        ? 'NORMALIZED_SUBSTRING'
        : matchesLiterally(core, mailText)
          ? 'LITERAL_BOUNDARY'
          : undefined;

    if (!matchedBy) continue;

    // One opportunity may appear twice in a candidate list assembled from
    // several queries; report it once.
    const key = `${candidate.orgId}#${candidate.projectId}#${candidate.oppId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    matches.push({ candidate, matchedNumber: stored as string, matchedBy });
  }

  return matches;
};

/**
 * The single opportunity a message may be acted on against, or null.
 *
 * Null covers both "nothing matched" and "several matched" — neither is
 * actionable without a human, and collapsing them here keeps callers from
 * having to remember that ambiguity is a refusal rather than a choice.
 */
export const resolveSingleCorrelation = (
  mailText: string,
  candidates: readonly CorrelationCandidate[],
): CorrelationMatch | null => {
  const matches = correlateMailToOpportunities(mailText, candidates);
  return matches.length === 1 ? (matches[0] as CorrelationMatch) : null;
};
