/**
 * Classifies an inbound message as an award/loss notice or a solicitation
 * cancellation, and extracts the identifiers needed to correlate it to an
 * opportunity.
 *
 * Deterministic first, LLM second. Sender domain and subject patterns settle the
 * overwhelming majority of solicitation mail at zero cost, which matters when the
 * scanner sees every message in a monitored mailbox. The model is reserved for
 * genuinely ambiguous bodies.
 *
 * IMPORTANT: classification alone never changes state. Only a deterministic
 * identifier match (noticeId / solicitationNumber) may act automatically —
 * everything else is recorded for a human. A misclassified message that pulled a
 * FOIA schedule forward would file a statutory request early, against the wrong
 * agency, for a contract that was never awarded.
 */

/** What a message appears to be about. */
export const MAIL_CLASSIFICATIONS = [
  /** An award was made — to us or (far more often) to a competitor. */
  'AWARD_NOTICE',
  /** The solicitation was cancelled; no award will follow. */
  'SOLICITATION_CANCELLED',
  /** An agency replying to a FOIA request we sent. */
  'FOIA_RESPONSE',
  /** Solicitation-related but not one of the above. */
  'OTHER_SOLICITATION',
  /** Not relevant to any opportunity. */
  'UNRELATED',
] as const;

export type MailClassification = (typeof MAIL_CLASSIFICATIONS)[number];

export interface ClassifiedMail {
  classification: MailClassification;
  /** HIGH only when a deterministic rule matched; nothing else may auto-act. */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Which rule produced the verdict, for the activity log. */
  matchedOn: string[];
  /** Identifiers for correlating to an opportunity. */
  noticeId?: string;
  solicitationNumber?: string;
  /** A FOIA tracking number, when the agency quoted one. */
  trackingNumber?: string;
  awardeeName?: string;
}

export interface InboundMailFields {
  from: string;
  subject: string;
  body: string;
}

/** Senders whose solicitation mail is structured and trustworthy. */
const KNOWN_SENDER_DOMAINS = [
  'sam.gov',
  'highergov.com',
  'dibbs.bsm.dla.mil',
  'dla.mil',
  'fbo.gov',
] as const;

/**
 * Award and loss notices.
 *
 * "Award posted" is the wording the feature request used, but a contractor who
 * has not won sees the loss side of the same event far more often — an
 * unsuccessful-offeror letter, or a SAM.gov notice naming someone else. Both are
 * the same trigger for FOIA purposes, so both match here.
 */
const AWARD_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\baward(ed)?\s+(notice|notification)\b/i, label: 'award-notice' },
  { re: /\bnotice\s+of\s+award\b/i, label: 'notice-of-award' },
  { re: /\bcontract\s+award(ed)?\b/i, label: 'contract-award' },
  { re: /\baward\s+has\s+been\s+(made|posted)\b/i, label: 'award-made' },
  // The loss side of the same event.
  { re: /\bunsuccessful\s+offeror\b/i, label: 'unsuccessful-offeror' },
  { re: /\bnot\s+(been\s+)?selected\s+for\s+award\b/i, label: 'not-selected' },
  { re: /\byour\s+(proposal|offer|quote)\s+was\s+not\s+selected\b/i, label: 'not-selected' },
  { re: /\bwas\s+not\s+successful\b/i, label: 'not-successful' },
];

const CANCELLED_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\b(solicitation|rfp|rfq|ifb)\b[^.]{0,40}\bcancel(l)?ed\b/i, label: 'solicitation-cancelled' },
  { re: /\bcancel(l)?ation\s+of\s+(solicitation|rfp|rfq)\b/i, label: 'cancellation-of' },
  { re: /\bnotice\s+of\s+cancel(l)?ation\b/i, label: 'notice-of-cancellation' },
  { re: /\bhas\s+been\s+cancel(l)?ed\b/i, label: 'has-been-cancelled' },
  { re: /\bwithdrawn\b[^.]{0,30}\bsolicitation\b/i, label: 'withdrawn' },
];

/** Agencies replying to a request we filed. */
const FOIA_RESPONSE_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bFOIA\s+(request|case|control)\s*(number|no\.?|#)/i, label: 'foia-case-number' },
  { re: /\byour\s+(FOIA|freedom\s+of\s+information)\s+request\b/i, label: 'your-foia-request' },
  { re: /\backnowledg(e|ing|ement|ment)\b[^.]{0,40}\bFOIA\b/i, label: 'foia-acknowledgement' },
  { re: /\b(public|open)\s+records\s+request\b[^.]{0,40}\b(received|acknowledg)/i, label: 'records-request-received' },
];

/**
 * Solicitation number patterns.
 *
 * Federal solicitation numbers are highly structured (e.g. W912DY-24-R-0001,
 * SP4701-25-Q-0123, 47QTCA24D001F), which is what makes correlation reliable
 * without a model. Deliberately strict: a loose pattern that matched any
 * hyphenated token would correlate mail to the wrong opportunity.
 */
const SOLICITATION_NUMBER_PATTERNS: ReadonlyArray<RegExp> = [
  // Standard FAR-style: 6 alnum, 2-digit FY, letter type, 4+ serial.
  /\b([A-Z0-9]{4,8}-?\d{2}-[A-Z]-\d{3,5})\b/g,
  // DLA/DIBBS style: SPE + digits.
  /\b(SP[A-Z0-9]{3,6}\d{2}[A-Z]\d{3,5})\b/g,
  // GSA schedule style.
  /\b(\d{2}[A-Z]{3}[A-Z0-9]{2}\d{2}[A-Z]\d{3,5}[A-Z]?)\b/g,
];

/** SAM.gov notice ids are 32-character hex. */
const NOTICE_ID_PATTERN = /\b([0-9a-f]{32})\b/i;

/** FOIA tracking numbers as agencies typically format them. */
const TRACKING_NUMBER_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:FOIA|case|control|request)\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9\-/]{4,24})\b/i,
  /\b(\d{4}-[A-Z]{2,6}-\d{4,6})\b/,
  /\b([A-Z]{2,6}-\d{4}-\d{4,6})\b/,
];

const matchFirst = (text: string, patterns: ReadonlyArray<RegExp>): string | undefined => {
  for (const pattern of patterns) {
    // Patterns carry /g in places; reset so repeated calls behave identically.
    pattern.lastIndex = 0;
    const m = pattern.exec(text);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
};

/** True when the sender is one of the structured solicitation sources. */
export const isKnownSolicitationSender = (from: string): boolean => {
  const lower = from.toLowerCase();
  return KNOWN_SENDER_DOMAINS.some((d) => lower.includes(d));
};

/** True when the sender looks like a government address. */
export const isGovernmentSender = (from: string): boolean =>
  /@[^\s>]*\.(gov|mil)\b/i.test(from);

/**
 * Classifies a message using deterministic rules only.
 *
 * Returns LOW confidence with `UNRELATED` when nothing matches, which is the
 * signal to escalate to the model — never to act.
 */
export const classifyMailDeterministic = (mail: InboundMailFields): ClassifiedMail => {
  const haystack = `${mail.subject}\n${mail.body}`;
  const matchedOn: string[] = [];

  if (isKnownSolicitationSender(mail.from)) matchedOn.push('known-sender');
  else if (isGovernmentSender(mail.from)) matchedOn.push('gov-sender');

  const hit = (patterns: ReadonlyArray<{ re: RegExp; label: string }>): string[] =>
    patterns.filter((p) => p.re.test(haystack)).map((p) => p.label);

  const foiaHits = hit(FOIA_RESPONSE_PATTERNS);
  const cancelledHits = hit(CANCELLED_PATTERNS);
  const awardHits = hit(AWARD_PATTERNS);

  const noticeId = NOTICE_ID_PATTERN.exec(haystack)?.[1];
  const solicitationNumber = matchFirst(haystack, SOLICITATION_NUMBER_PATTERNS);
  const trackingNumber = matchFirst(haystack, TRACKING_NUMBER_PATTERNS);

  const hasIdentifier = !!(noticeId || solicitationNumber);

  /**
   * HIGH requires BOTH a phrase match and a usable identifier. A phrase alone
   * cannot be acted on: knowing *some* solicitation was cancelled is useless
   * without knowing which one, and guessing would suppress the wrong FOIA.
   */
  const confidenceFor = (hits: string[]): 'HIGH' | 'MEDIUM' =>
    hits.length > 0 && hasIdentifier ? 'HIGH' : 'MEDIUM';

  // FOIA responses are checked first: an agency's reply about a request that
  // mentions the underlying award would otherwise read as an award notice.
  if (foiaHits.length > 0) {
    return {
      classification: 'FOIA_RESPONSE',
      // A tracking number is the identifier that matters for a reply.
      confidence: trackingNumber ? 'HIGH' : 'MEDIUM',
      matchedOn: [...matchedOn, ...foiaHits],
      ...(noticeId ? { noticeId } : {}),
      ...(solicitationNumber ? { solicitationNumber } : {}),
      ...(trackingNumber ? { trackingNumber } : {}),
    };
  }

  // Cancellation before award: a cancellation notice often names the award
  // process it is terminating, and suppressing is safer than filing early.
  if (cancelledHits.length > 0) {
    return {
      classification: 'SOLICITATION_CANCELLED',
      confidence: confidenceFor(cancelledHits),
      matchedOn: [...matchedOn, ...cancelledHits],
      ...(noticeId ? { noticeId } : {}),
      ...(solicitationNumber ? { solicitationNumber } : {}),
    };
  }

  if (awardHits.length > 0) {
    return {
      classification: 'AWARD_NOTICE',
      confidence: confidenceFor(awardHits),
      matchedOn: [...matchedOn, ...awardHits],
      ...(noticeId ? { noticeId } : {}),
      ...(solicitationNumber ? { solicitationNumber } : {}),
    };
  }

  // Solicitation-ish but unclassified — worth recording, not acting on.
  if (matchedOn.length > 0 && hasIdentifier) {
    return {
      classification: 'OTHER_SOLICITATION',
      confidence: 'LOW',
      matchedOn,
      ...(noticeId ? { noticeId } : {}),
      ...(solicitationNumber ? { solicitationNumber } : {}),
    };
  }

  return { classification: 'UNRELATED', confidence: 'LOW', matchedOn };
};

/**
 * Whether a classification may change opportunity state without a human.
 *
 * The bar is deliberately high: a HIGH-confidence verdict plus an identifier we
 * can correlate. Everything else is surfaced for review.
 */
export const canActAutomatically = (classified: ClassifiedMail): boolean =>
  classified.confidence === 'HIGH' &&
  (classified.classification === 'AWARD_NOTICE' ||
    classified.classification === 'SOLICITATION_CANCELLED') &&
  !!(classified.noticeId || classified.solicitationNumber);
