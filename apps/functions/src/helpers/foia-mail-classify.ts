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

import { stripQuotedReply } from '@/helpers/foia-mail-parse';

/** What a message appears to be about. */
export const MAIL_CLASSIFICATIONS = [
  /** An award was made — to us or (far more often) to a competitor. */
  'AWARD_NOTICE',
  /** The solicitation was cancelled; no award will follow. */
  'SOLICITATION_CANCELLED',
  /** An agency replying to a FOIA request we sent. */
  'FOIA_RESPONSE',
  /**
   * A records request *we* sent, seen from the monitored mailbox.
   *
   * The mailbox is the reply-to on outbound requests, so it receives its own
   * traffic. Without this class those copies fall through to UNRELATED, which is
   * safe but throws away the useful signal that a request went out — and risks a
   * future rule treating our own letter's award wording as an award notice.
   */
  'OUR_OWN_REQUEST',
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
  // "Notification of Award" / "Notice of Award" — the real subject line, and the
  // reverse word order of the pattern above. Matching only "award notice" missed
  // the actual trigger this feature exists to catch.
  { re: /\b(notice|notification)\s+of\s+award\b/i, label: 'notification-of-award' },
  // The structured status block state agencies publish: "Status: Awarded".
  { re: /\bstatus\s*:?\s*awarded\b/i, label: 'status-awarded' },
  { re: /\baward\s+date\b\s*:?\s*\d/i, label: 'award-date-stated' },
  { re: /\bcontract\s+award(ed)?\b/i, label: 'contract-award' },
  { re: /\baward\s+has\s+been\s+(made|posted)\b/i, label: 'award-made' },
  { re: /\bhas\s+been\s+awarded\s+to\b/i, label: 'awarded-to' },
  /**
   * "Award(s) Published for ..." — BidNet's real subject line, and the third
   * distinct award phrasing real mail has produced that the patterns missed. The
   * parenthesised plural is the trap: `\baward(ed)?\b` cannot match "Award(s)",
   * because `(s)` is literal text rather than an inflection.
   *
   * Also covers "bid results" and "abstract of bids", which are award
   * announcements in substance — they name the winner.
   */
  { re: /\baward\(s\)/i, label: 'award-parenthesised-plural' },
  { re: /\bawards?\s+(published|posted|announced)\b/i, label: 'award-published' },
  { re: /\bbid\s+results?\s+(published|posted|announced|available)\b/i, label: 'bid-results' },
  { re: /\babstract\s+of\s+bids\b/i, label: 'abstract-of-bids' },
  { re: /\bapparent\s+low\s+bidder\b/i, label: 'apparent-low-bidder' },
  // The loss side of the same event.
  { re: /\bunsuccessful\s+offeror\b/i, label: 'unsuccessful-offeror' },
  { re: /\bnot\s+(been\s+)?selected\s+for\s+award\b/i, label: 'not-selected' },
  { re: /\byour\s+(proposal|offer|quote)\s+was\s+not\s+selected\b/i, label: 'not-selected' },
  { re: /\bwas\s+not\s+successful\b/i, label: 'not-successful' },
];

/**
 * An AWARD POSTING being retracted, which is not a cancelled solicitation.
 *
 * BidNet publishes "The following award has been cancelled: Solicitation: 4142 —
 * Award Type: Award" when a posting is withdrawn. The solicitation is alive and a new
 * award will follow, so suppressing the FOIA is the exact inverse of correct — and
 * verified by replay, a message like this DID produce `SUPPRESSED` whenever we held
 * the matching opportunity. It escaped only because no stored opportunity is
 * numbered 4142.
 *
 * Checked before the cancellation patterns, which otherwise both match: the subject
 * "'Award' for the 4142 solicitation has been cancelled" satisfies
 * `has-been-cancelled` and (with no sentence boundary between the words)
 * `solicitation-cancelled` too.
 */
const AWARD_RETRACTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:the\s+)?(?:following\s+)?award\b[^.]{0,40}\bhas\s+been\s+cancel(?:l)?ed\b/i,
  /\baward\s+type\s*:?\s*award\b/i,
  /\b["']?award["']?\s+for\s+the\b[^.]{0,40}\bsolicitation\s+has\s+been\s+cancel(?:l)?ed\b/i,
];

const CANCELLED_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\b(solicitation|rfp|rfq|ifb)\b[^.]{0,40}\bcancel(l)?ed\b/i, label: 'solicitation-cancelled' },
  /**
   * "was cancelled" — the form real agencies use in a reply.
   *
   * CA State Parks wrote "Unfortunately, C25910004 was cancelled and not awarded via
   * IFB" (`i3o2h82ak04i`, `pm4tl45k4m77`). `has-been-cancelled` requires "has been",
   * and `solicitation-cancelled` requires the solicitation keyword to PRECEDE the
   * verb — here "IFB" trails it — so a stated cancellation matched nothing.
   */
  { re: /\bwas\s+cancel(l)?ed\b/i, label: 'was-cancelled' },
  { re: /\bcancel(l)?ed\s+and\s+not\s+awarded\b/i, label: 'cancelled-not-awarded' },
  { re: /\bcancel(l)?ation\s+of\s+(solicitation|rfp|rfq)\b/i, label: 'cancellation-of' },
  { re: /\bnotice\s+of\s+cancel(l)?ation\b/i, label: 'notice-of-cancellation' },
  { re: /\bhas\s+been\s+cancel(l)?ed\b/i, label: 'has-been-cancelled' },
  { re: /\bwithdrawn\b[^.]{0,30}\bsolicitation\b/i, label: 'withdrawn' },
];

/**
 * Records-request subject lines as they are actually written.
 *
 * Every one of these is taken from real correspondence in this mailbox. The
 * original patterns here assumed federal "FOIA" vocabulary and matched none of
 * them: state work says "Public Records Act Request", "Texas Public Information
 * Act Request", or just "PRA 26-528 - Response". Requiring the word FOIA made
 * the classifier blind to the majority of the traffic it exists to read.
 */
const RECORDS_REQUEST_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  // Named statutes, federal and state. "Act Request" is the invariant.
  {
    re: /\b(freedom\s+of\s+information|public\s+records|public\s+information|open\s+records|right[\s-]to[\s-]know)\s+act\s+request\b/i,
    label: 'records-act-request',
  },
  // Bare acronym plus a tracking number: "PRA 26-528", "PIA 2026-004".
  { re: /\b(FOIA|PRA|CPRA|PIA|OPRA|FOIL|APRA|GRAMA)\b[\s#:-]*\d{2,4}[-–]\d{2,6}\b/i, label: 'acronym-tracking' },
  { re: /\b(public|open)\s+records\s+request\b/i, label: 'records-request' },
  { re: /\b(freedom\s+of\s+information|public\s+information)\s+act\b/i, label: 'records-act' },
];

/** Agencies replying to a request we filed. */
const FOIA_RESPONSE_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bFOIA\s+(request|case|control)\s*(number|no\.?|#)/i, label: 'foia-case-number' },
  { re: /\byour\s+(FOIA|freedom\s+of\s+information)\s+request\b/i, label: 'your-foia-request' },
  { re: /\backnowledg(e|ing|ement|ment)\b[^.]{0,40}\bFOIA\b/i, label: 'foia-acknowledgement' },
  { re: /\b(public|open)\s+records\s+request\b[^.]{0,40}\b(received|acknowledg)/i, label: 'records-request-received' },
  // Real reply shapes: "PRA 26-528 - Response - 07.17.26",
  // "Response: RFP No. 26-16, ...", "your ... request #26-112 has been closed."
  { re: /^\s*(?:re|fwd|fw)?\s*:?\s*response\s*[:\-–]/i, label: 'response-subject' },
  { re: /\b(?:in\s+)?(?:further\s+)?response\s+to\s+your\b/i, label: 'in-response-to-your' },
  { re: /\b(?:is\s+in\s+)?receipt\s+of\s+your\b[^.]{0,60}\brequest\b/i, label: 'receipt-of-your-request' },
  // Only an agency says it is *providing* records; our own letter asks for them.
  // A bare "responsive records" match is not enough — that phrase appears three
  // times in our own template, which made every outbound letter classify as an
  // agency reply and would have marked requests answered that were never sent.
  {
    re: /\b(?:see\s+the\s+)?attached\s+responsive\s+(documents|records)\b/i,
    label: 'attached-responsive-records',
  },
  {
    re: /\b(?:has|have)\s+(?:been\s+)?located\b[^.]{0,40}\b(responsive|record)/i,
    label: 'records-located',
  },
  // Singular and plural both: agencies write "no record ... was located" and "no
  // records were located" interchangeably, and a singular-only pattern misses half.
  {
    re: /\bno\s+(?:records?|documents?)\b[^.]{0,60}\b(?:was|were)\s+(?:located|found|identified)\b/i,
    label: 'no-records-located',
  },
  { re: /\brequest\s*#?\s*[\w-]+\s+has\s+been\s+(closed|completed|fulfilled)\b/i, label: 'request-closed' },
  /**
   * "We have received your CPRA / FOIA request." — LAFPP's real acknowledgement
   * (`cvfodjo47ucp`), which classified UNRELATED with `matchedOn: []`.
   *
   * `we-received-your-request` requires `request|records` IMMEDIATELY after "your",
   * so the interposed statute name defeated it. Allowing a short gap covers every
   * variant agencies actually write ("your CPRA request", "your public records
   * request", "your CPRA / FOIA request") without loosening it into prose.
   */
  {
    re: /\b(?:we|this\s+office|our\s+office)\s+(?:have|has)\s+received\s+your\b[^.]{0,40}\brequest\b/i,
    label: 'we-received-your-request-gapped',
  },
  /**
   * An agency issuing its own tracking number is replying, by definition. Real forms:
   * "Your request number is CPRA-0319", "your reference number is 26-528".
   */
  {
    re: /\byour\s+(?:request|reference|case|control)\s+number\s+is\b/i,
    label: 'assigned-tracking-number',
  },
  // Real agency reply openings. Without these, a reply that happens to explain a
  // cancellation was classified as a CANCELLATION TRIGGER — which would suppress
  // the automation off the agency's own answer to a request we already filed.
  { re: /\bour\s+office\s+has\s+received\s+your\b/i, label: 'office-received-your' },
  { re: /\b(?:we|this\s+office)\s+(?:have|has)\s+received\s+your\s+(?:request|records)\b/i, label: 'we-received-your-request' },
  { re: /\byour\s+request\s+regarding\b/i, label: 'your-request-regarding' },
  // "PRA 26-528 - Response - 07.17.26". No \b before the separator: between a
  // space and a hyphen there is no word boundary, so anchoring one there never
  // matched the real subject line.
  {
    re: /\b(?:FOIA|PRA|CPRA|PIA|OPRA|FOIL|APRA|GRAMA)\b[^.\n]{0,24}[-–:]\s*response\b/i,
    label: 'acronym-response',
  },
];

/**
 * Our own outbound request, echoed back by the mailbox.
 *
 * Distinguished from an agency reply by the absence of reply markers: an outbound
 * request names a statute but does not say "Response", "receipt of your", or
 * quote a tracking number the agency assigned.
 */
const OUTBOUND_MARKERS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bthis\s+(email|letter)\s+constitutes\s+a\s+formal\s+request\b/i, label: 'formal-request-body' },
  { re: /\bplease\s+confirm\s+receipt\s+of\s+this\s+request\b/i, label: 'please-confirm-receipt' },
  { re: /\bthis\s+is\s+a\s+request\s+under\b/i, label: 'request-under' },
  /**
   * Broader markers, added after real letters matched none of the three above.
   *
   * Two genuine outbound requests in the archive carried only "pursuant to the
   * ... Act" and "on behalf of" — so the outbound gate never fired and both were
   * read as agency triggers instead. One became an AWARD_NOTICE purely because the
   * letter *asks for* "the notice of award" as a document.
   */
  { re: /\bpursuant\s+to\b[^.]{0,80}\bAct\b/i, label: 'pursuant-to-act' },
  { re: /\bon\s+behalf\s+of\b[^.]{0,60}\b(?:proposer|offeror|bidder|company|firm)\b/i, label: 'on-behalf-of-bidder' },
  { re: /\bthe\s+undersigned\b/i, label: 'the-undersigned' },
  { re: /\brequest\s+production\s+of\s+the\s+following\b/i, label: 'request-production' },
  { re: /\bcopies\s+of\s+the\s+following\s+public\s+records\b/i, label: 'copies-of-following' },
];

/**
 * Phrases that mean a document is being ASKED FOR, not announced.
 *
 * Our own letter itemises "the notice of award and the awarded contract value" as
 * a record to produce. Read without context that is indistinguishable from an
 * agency announcing an award — and it caused exactly that misread on a real
 * request. Award and cancellation phrases appearing inside a numbered request list
 * are therefore discounted.
 */
const REQUEST_CONTEXT_MARKERS: ReadonlyArray<RegExp> = [
  /\b(?:request|requests|requesting|provide|produce|copies)\b[^.]{0,120}\bnotice\s+of\s+award\b/i,
  /\bnotice\s+of\s+award\b[^.]{0,80}\b(?:and\s+the\s+awarded\s+contract\s+value|contract\/PO\s+number)\b/i,
  /\ball\s+(?:individual\s+)?evaluat(?:or|ion)\b/i,
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

/**
 * Tracking numbers as agencies actually issue them.
 *
 * The federal-style patterns below (2026-ARMY-01234) are real but rare in this
 * pipeline. What real state and municipal agencies send is much terser and was
 * matched by none of the original patterns: "PRA 26-528", "PRA 2026-278",
 * "request #26-112", "Public Records Act Request – 26-528 – IFB C25910004".
 *
 * The short numeric forms are only recognised next to a records-request acronym
 * or the word "request", because a bare "26-528" is indistinguishable from a
 * date, a line item, or a solicitation number.
 */
const TRACKING_NUMBER_PATTERNS: ReadonlyArray<RegExp> = [
  // Acronym-anchored: "PRA 26-528", "FOIA 2026-278", "PIA #26-112".
  /\b(?:FOIA|PRA|CPRA|PIA|OPRA|FOIL|APRA|GRAMA)\b[\s#:.-]*(\d{2,4}[-–]\d{2,6})\b/i,
  /**
   * Acronym plus a SINGLE digit group: "CPRA-0319" (LAFPP's real number).
   *
   * The pattern above needs two dash-separated groups, so an acronym-and-sequence
   * number was discarded — and that is the number the agency asks us to quote on
   * every follow-up ("Please reference your request number"). Losing it means the
   * next reply in the thread has nothing to correlate against either.
   *
   * Captures the acronym too, since "0319" alone identifies nothing. Requires a
   * hyphen so a bare "FOIA 2026" cannot match.
   */
  /\b((?:FOIA|PRA|CPRA|PIA|OPRA|FOIL|APRA|GRAMA)-\d{3,6})\b/i,
  // Federal agency style: 2026-ARMY-01234 / NAVY-2026-004567.
  /\b(\d{4}-[A-Z]{2,6}-\d{4,6})\b/,
  /\b([A-Z]{2,6}-\d{4}-\d{4,6})\b/,
  // "request #26-112", "request number 26-528", "Request No. 2026-278", and the
  // en-dash form agencies use in subject lines: "Request – 26-528 – IFB C...".
  // The separator class must include both dash characters; agencies use en
  // dashes freely and a hyphen-only class silently missed every one.
  /\brequest\s*(?:number|no\.?|#)?\s*[:#\-–]?\s*(\d{2,4}[-–]\d{2,6})\b/i,
  // Generic labelled form, last so the specific ones win.
  /\b(?:case|control)\s*(?:number|no\.?|#)\s*:?\s*([A-Z0-9][A-Z0-9\-/]{4,24})\b/i,
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

/**
 * True when the sender looks like a public body.
 *
 * `.edu` is included, and it is not an edge case: state universities, community
 * college districts and school districts are a large share of this pipeline, and
 * every real sample so far came from one (`ttuhsc.edu`, `sbcusd.k12.ca.us`).
 * Restricting this to `.gov`/`.mil` made the classifier blind to the senders it
 * most often sees. `.us` covers the `k12.*.us` districts.
 *
 * A public-body sender is only ever *evidence*, never permission: it raises how
 * seriously a message is read, and nothing acts without an identifier as well.
 */
export const isGovernmentSender = (from: string): boolean =>
  /@[^\s>]*\.(gov|mil|edu|us)\b/i.test(from);

/**
 * The public-body author of a forwarded message, when the envelope hides them.
 *
 * The monitored mailbox is a Google Group, and the relay rewrites `From:` to
 * `proposals@horustech.dev` — so `isGovernmentSender` returns false for genuine
 * agency replies, and the sender evidence is lost exactly when it matters. The real
 * author survives in the forwarded header block inside the body.
 *
 * Scans the quoted `From:` lines and returns true on the first public-body address,
 * stopping at the first line naming us: past that point we are reading OUR original
 * letter's own headers, and the agency addresses below it are the ones we wrote TO,
 * not from. Without that stop, every outbound request addressed to a `.gov` would
 * look agency-authored.
 *
 * Verified against the corpus: recovers the two CA Parks messages whose agency
 * identity is only in the body, and misfires on none of the 11 genuine outbound
 * letters.
 */
const QUOTED_FROM_PATTERN = /^[ \t>]*\*?From:\*?[ \t]*(.{0,180})$/gim;

export const hasGovernmentAuthorInThread = (body: string): boolean => {
  for (const match of body.matchAll(QUOTED_FROM_PATTERN)) {
    const value = match[1] ?? '';
    if (/horustech/i.test(value)) return false;
    if (isGovernmentSender(value)) return true;
  }
  return false;
};

/**
 * Classifies a message using deterministic rules only.
 *
 * Returns LOW confidence with `UNRELATED` when nothing matches, which is the
 * signal to escalate to the model — never to act.
 */
export const classifyMailDeterministic = (mail: InboundMailFields): ClassifiedMail => {
  const haystack = `${mail.subject}\n${mail.body}`;

  /**
   * The same message with our own quoted letter removed.
   *
   * Everything that decides WHO WROTE THE MESSAGE must be judged on this, not on the
   * full body. Agencies quote our request in full, so the full body always contains
   * our letter's wording — and reading it there is what made seven live agency
   * replies classify as our own outgoing mail, discarded a stated cancellation, and
   * produced a `DENIED` outcome off our own boilerplate.
   *
   * Patterns describing WHAT HAPPENED (records statutes, identifiers, tracking
   * numbers) still read the full body: a solicitation number quoted lower in the
   * thread is equally true wherever it appears, and the terse replies have almost no
   * body of their own.
   */
  const ownWordsHaystack = `${mail.subject}\n${stripQuotedReply(mail.body)}`;
  const matchedOn: string[] = [];

  if (isKnownSolicitationSender(mail.from)) matchedOn.push('known-sender');
  else if (isGovernmentSender(mail.from)) matchedOn.push('gov-sender');

  const hit = (patterns: ReadonlyArray<{ re: RegExp; label: string }>): string[] =>
    patterns.filter((p) => p.re.test(haystack)).map((p) => p.label);

  /** Matches only text the sender actually wrote, ignoring anything quoted from us. */
  const hitOwnWords = (patterns: ReadonlyArray<{ re: RegExp; label: string }>): string[] =>
    patterns.filter((p) => p.re.test(ownWordsHaystack)).map((p) => p.label);

  const foiaHits = hit(FOIA_RESPONSE_PATTERNS);
  const recordsHits = hit(RECORDS_REQUEST_PATTERNS);
  /**
   * Outbound markers are an authorship claim, so they only count in our own words.
   *
   * This is the fix for the whole class: "pursuant to the ... Act" proves the message
   * is ours only when WE wrote that line. Quoted back to us beneath an agency's
   * reply it proves the opposite — that someone is replying to us.
   */
  const outboundHits = hitOwnWords(OUTBOUND_MARKERS);

  /**
   * A message that itemises records to produce is a request, not an announcement.
   *
   * Discounting award and cancellation hits here is what stops our own letter's
   * "the notice of award and the awarded contract value" line from reading as an
   * agency announcing an award. Records-request wording is left intact, since that
   * is genuinely what the message is.
   *
   * Also scoped to our own words: when an agency quotes our numbered request list
   * and then states that the solicitation was cancelled, the quoted list must not
   * suppress the agency's own statement (real messages `i3o2h82ak04i`,
   * `pm4tl45k4m77`).
   */
  const isRequestContext = REQUEST_CONTEXT_MARKERS.some((re) => re.test(ownWordsHaystack));

  /**
   * A retracted award posting must not read as a cancelled solicitation.
   *
   * It is an award-side event: the solicitation continues and a new award follows, so
   * suppressing the FOIA would withdraw the automation precisely when an award is
   * coming. Cancellation hits are dropped and the message falls through to the award
   * branch, which flags rather than suppresses.
   */
  const isAwardRetraction = AWARD_RETRACTION_PATTERNS.some((re) => re.test(ownWordsHaystack));

  const cancelledHits =
    isRequestContext || isAwardRetraction ? [] : hitOwnWords(CANCELLED_PATTERNS);
  /**
   * A retraction is award-side news, so it is recorded as an AWARD_NOTICE rather than
   * discarded. Without this it falls through to UNRELATED — the one class that leaves
   * nothing behind — even though it says something real about a live procurement.
   *
   * It cannot act on its own: no award date is stated, so `awardDateFromMail` returns
   * the receipt-date fallback, whose `RECORDED_OUTCOME` provenance is refused by the
   * `RECORDED_AWARD` guard in `applyAwardNotice`. The outcome is a flag for review,
   * which is the right answer for "the award you were told about was withdrawn".
   */
  const awardHits = isRequestContext
    ? []
    : isAwardRetraction
      ? [...hitOwnWords(AWARD_PATTERNS), 'award-retracted']
      : hitOwnWords(AWARD_PATTERNS);

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

  /**
   * Our own outbound request, before anything else.
   *
   * The monitored mailbox is the reply-to on every request we send, so it sees
   * its own traffic. Our letters name a statute and describe an award, which is
   * precisely the wording the award and records rules look for — so this must be
   * settled first or we would classify our own mail as an agency's.
   *
   * A reply marker outranks an outbound marker, because agencies quote the
   * original request in full: "in further response to your Public Records Act
   * request ... in which you request: '...'" carries both.
   */
  if (outboundHits.length > 0 && foiaHits.length === 0) {
    return {
      classification: 'OUR_OWN_REQUEST',
      confidence: 'HIGH',
      matchedOn: [...matchedOn, ...outboundHits, ...recordsHits],
      ...(noticeId ? { noticeId } : {}),
      ...(solicitationNumber ? { solicitationNumber } : {}),
      ...(trackingNumber ? { trackingNumber } : {}),
    };
  }

  // FOIA responses are checked next: an agency's reply about a request that
  // mentions the underlying award would otherwise read as an award notice.
  if (foiaHits.length > 0) {
    return {
      classification: 'FOIA_RESPONSE',
      // A tracking number is the identifier that matters for a reply; a
      // correlatable solicitation number serves the same purpose, and many
      // agencies quote only that ("Response: RFP No. 26-16, ...").
      confidence: trackingNumber || solicitationNumber ? 'HIGH' : 'MEDIUM',
      matchedOn: [...matchedOn, ...foiaHits, ...recordsHits],
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

  /**
   * Names a records statute but carries neither reply nor outbound markers.
   *
   * Most likely our own request seen without its body (a forwarded subject line
   * only). Recorded as our own rather than as an agency reply, since misfiling it
   * as a response would mark a request answered that never was.
   *
   * UNLESS a public body sent it AND wrote something of its own. We do not send
   * mail from a `.gov`/`.mil`/`.edu`/`.us` address, so an agency-domain sender who
   * has written prose above the quoted thread is corresponding with us about a
   * request — it cannot be our own outgoing letter. This is where `gov-sender`
   * finally earns its keep: it was computed above and then ignored, which let a
   * school-district buyer's genuine reply (`obc93sn2d5kk`) be filed as our own
   * request even after its quoted text was discounted. Terse agency replies
   * routinely carry no recognised reply marker at all, so without this they land
   * here.
   *
   * The "wrote something of its own" half matters: a bare forwarded SUBJECT LINE
   * with no body is most likely our own letter relayed onward, and the sender
   * address of a forward tells you nothing about who wrote the original. Requiring
   * some first-party prose keeps that case as ours while catching the real replies.
   *
   * MEDIUM, not HIGH: a reply is never a trigger, and correlation still gates
   * whether anything is attached, so being wrong here costs a review rather than a
   * filing.
   */
  if (recordsHits.length > 0) {
    const isPublicBodySender =
      isGovernmentSender(mail.from) || hasGovernmentAuthorInThread(mail.body);
    const wroteOwnProse = stripQuotedReply(mail.body).trim().length > 0;

    return {
      classification: isPublicBodySender && wroteOwnProse ? 'FOIA_RESPONSE' : 'OUR_OWN_REQUEST',
      confidence: 'MEDIUM',
      matchedOn: [...matchedOn, ...recordsHits],
      ...(noticeId ? { noticeId } : {}),
      ...(solicitationNumber ? { solicitationNumber } : {}),
      ...(trackingNumber ? { trackingNumber } : {}),
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
 * Two things are required: the message must be a trigger (an award or a
 * cancellation — a reply never moves a schedule), and it must be tied to a
 * specific procurement. Knowing *some* solicitation was cancelled is useless
 * without knowing which one, and guessing would suppress the wrong FOIA.
 *
 * `hasExternalIdentifier` is how a caller contributes the second half. The
 * classifier's own solicitation-number patterns are federal-shaped and match
 * almost nothing in a real state and local pipeline — 11 of 360 stored numbers —
 * so requiring them here would refuse every genuine state award notice. A
 * correlation against a solicitation number we already hold is *stronger*
 * evidence than parsing one out of the text, because it can only ever point at an
 * opportunity that exists. The caller passes true once it has exactly one match.
 */
export const canActAutomatically = (
  classified: ClassifiedMail,
  options: { hasExternalIdentifier?: boolean } = {},
): boolean => {
  const isTrigger =
    classified.classification === 'AWARD_NOTICE' ||
    classified.classification === 'SOLICITATION_CANCELLED';

  if (!isTrigger) return false;

  const identified =
    !!classified.noticeId || !!classified.solicitationNumber || !!options.hasExternalIdentifier;

  if (!identified) return false;

  // A phrase match plus an identifier is HIGH by construction; an external
  // identifier supplies the same assurance the classifier's own would have.
  return classified.confidence === 'HIGH' || !!options.hasExternalIdentifier;
};
