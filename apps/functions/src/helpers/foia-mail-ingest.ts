import type { FoiaAwardDateProvenance, OpportunityDBItem } from '@auto-rfp/core';

import { FOIA_MAIL_SCAN_PK, FOIA_MAIL_SCAN_TTL_DAYS } from '@/constants/foia';
import { createItem } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import {
  canActAutomatically,
  classifyMailDeterministic,
  type ClassifiedMail,
} from '@/helpers/foia-mail-classify';
import { parseRawMail } from '@/helpers/foia-mail-parse';
import {
  correlateMailToOpportunities,
  type CorrelationCandidate,
  type CorrelationMatch,
} from '@/helpers/foia-mail-correlate';

/**
 * Level 1: turns an inbound message into a decision about an opportunity.
 *
 * The pipeline is parse → classify → correlate → act, and every stage can refuse.
 * That is the design: this is the automated path to sending a statutory legal
 * request, so the failure mode to avoid is not "missed an email" (Level 2's timer
 * still fires) but "acted on the wrong one". A missed message costs a delay; a
 * wrong correlation files a request against the wrong agency about the wrong
 * procurement, in the customer's name.
 */

/** What ingestion decided to do with a message. */
export const MAIL_INGEST_ACTIONS = [
  /** Recorded a real award date and re-anchored the FOIA timer. */
  'AWARD_RECORDED',
  /** Solicitation cancelled — the automation is suppressed. */
  'SUPPRESSED',
  /** An agency reply, attached to the opportunity's FOIA request. */
  'RESPONSE_ATTACHED',
  /** Our own outbound request, seen from the monitored mailbox. */
  'OWN_REQUEST_LOGGED',
  /** Classified but not actionable — recorded for a human. */
  'FLAGGED_FOR_REVIEW',
  /** Not related to any opportunity. */
  'IGNORED',
  /** Already processed; this delivery changed nothing. */
  'DUPLICATE',
] as const;

export type MailIngestAction = (typeof MAIL_INGEST_ACTIONS)[number];

export interface MailIngestResult {
  action: MailIngestAction;
  classification: ClassifiedMail;
  /** The single opportunity acted on, when there was exactly one. */
  match?: CorrelationMatch;
  /** Populated when correlation was ambiguous — why we refused. */
  ambiguousMatches?: CorrelationMatch[];
  attachmentNames: string[];
}

/** The ledger row proving a message was seen, so redelivery cannot double-apply. */
export interface FoiaMailScanLedgerItem {
  messageId: string;
  orgId: string;
  receivedAt: string;
  action: MailIngestAction;
  classification: string;
  s3Key?: string;
  oppId?: string;
  ttl: number;
}

/**
 * Records that a message was handled, and reports whether it is new.
 *
 * A conditional create is the concurrency control: SES retries on any Lambda
 * error, and an at-least-once delivery that re-recorded an award or re-attached a
 * document would corrupt the opportunity. Losing the race is not an error — it
 * means someone else already did the work.
 */
export const claimInboundMessage = async (args: {
  messageId: string;
  orgId: string;
  action: MailIngestAction;
  classification: string;
  s3Key?: string;
  oppId?: string;
}): Promise<boolean> => {
  const item: FoiaMailScanLedgerItem = {
    messageId: args.messageId,
    orgId: args.orgId,
    receivedAt: nowIso(),
    action: args.action,
    classification: args.classification,
    ...(args.s3Key ? { s3Key: args.s3Key } : {}),
    ...(args.oppId ? { oppId: args.oppId } : {}),
    // Expire the ledger, not the outcome. The award date and attached documents
    // live on the opportunity; this row only needs to outlast any plausible
    // redelivery window.
    ttl: Math.floor(Date.now() / 1000) + FOIA_MAIL_SCAN_TTL_DAYS * 24 * 60 * 60,
  };

  try {
    await createItem(FOIA_MAIL_SCAN_PK, buildMailScanSk(args.messageId), item);
    return true;
  } catch (err) {
    if ((err as { name?: string })?.name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
};

/**
 * Message-ID is the key.
 *
 * It is globally unique per RFC 5322 and stable across redelivery, which SES
 * message ids are not — SES assigns a fresh one per receipt, so keying on that
 * would let the same email through twice.
 */
export const buildMailScanSk = (messageId: string): string => messageId.trim();

/**
 * Decides what a message means, without writing anything.
 *
 * Split from the acting so it can be exercised against real messages — the
 * acceptance gate replays actual correspondence through this and reads the table
 * of decisions before anything is allowed to mutate an opportunity.
 */
export const decideInboundMail = (args: {
  from: string;
  subject: string;
  raw: string;
  candidates: readonly CorrelationCandidate[];
}): MailIngestResult => {
  const { from, subject, raw, candidates } = args;

  const { text, attachmentNames } = parseRawMail(raw);
  const classification = classifyMailDeterministic({ from, subject, body: text });

  // Correlate over subject and body together: agencies put the solicitation
  // number in either, and the terse replies ("PRA 26-528 - Response") have
  // essentially no body at all.
  const matches = correlateMailToOpportunities(`${subject}\n${text}`, candidates);
  const single = matches.length === 1 ? matches[0] : undefined;

  const base = { classification, attachmentNames } as const;

  // Ambiguity is a refusal everywhere below, so settle it once here.
  if (matches.length > 1) {
    return { ...base, action: 'FLAGGED_FOR_REVIEW', ambiguousMatches: matches };
  }

  switch (classification.classification) {
    case 'AWARD_NOTICE':
      // The only path that moves a schedule. Requires a deterministic identifier
      // AND exactly one correlated opportunity.
      return canActAutomatically(classification, { hasExternalIdentifier: !!single }) && single
        ? { ...base, action: 'AWARD_RECORDED', match: single }
        : { ...base, action: 'FLAGGED_FOR_REVIEW', ...(single ? { match: single } : {}) };

    case 'SOLICITATION_CANCELLED':
      return canActAutomatically(classification, { hasExternalIdentifier: !!single }) && single
        ? { ...base, action: 'SUPPRESSED', match: single }
        : { ...base, action: 'FLAGGED_FOR_REVIEW', ...(single ? { match: single } : {}) };

    case 'FOIA_RESPONSE':
      // A reply is never a trigger — it cannot move a schedule. Attaching it needs
      // only a correlation, since the worst case is a document on the wrong
      // opportunity rather than a request sent to the wrong agency.
      return single
        ? { ...base, action: 'RESPONSE_ATTACHED', match: single }
        : { ...base, action: 'FLAGGED_FOR_REVIEW' };

    case 'OUR_OWN_REQUEST':
      return { ...base, action: 'OWN_REQUEST_LOGGED', ...(single ? { match: single } : {}) };

    case 'OTHER_SOLICITATION':
      return { ...base, action: 'FLAGGED_FOR_REVIEW', ...(single ? { match: single } : {}) };

    case 'UNRELATED':
    default:
      return { ...base, action: 'IGNORED' };
  }
};

/**
 * The award date an award notice establishes.
 *
 * Prefers the agency's own stated award date when the message carries one, and
 * falls back to the receipt date — which is still a recorded fact about a real
 * announcement, and strictly better evidence than a bid deadline. This is what
 * lets the timer re-anchor to something true.
 */
export const awardDateFromMail = (args: {
  receivedAt: string;
  bodyText: string;
}): { date: string; provenance: FoiaAwardDateProvenance } => {
  const stated = /\bAward\s+Date\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/i.exec(
    args.bodyText,
  );

  if (stated?.[1]) {
    const value = stated[1];
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    if (slash) {
      const [, month, day, year] = slash;
      const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return { date: iso, provenance: 'RECORDED_AWARD' };
    }
    return { date: value, provenance: 'RECORDED_AWARD' };
  }

  return { date: args.receivedAt.slice(0, 10), provenance: 'RECORDED_AWARD' };
};

/**
 * Reduces opportunities to what the correlator needs.
 *
 * Drops any record missing an org or project id. Those are the keys every
 * downstream write is scoped by, so a candidate without them could only produce a
 * match we cannot act on — and in a multi-tenant table, acting on an
 * unattributed record is the one mistake worth being paranoid about.
 */
export const toCorrelationCandidates = (
  opportunities: readonly OpportunityDBItem[],
): CorrelationCandidate[] =>
  opportunities.flatMap((opp) => {
    const oppId = opp.oppId ?? opp.id;
    if (!oppId || !opp.orgId || !opp.projectId) return [];

    return [
      {
        oppId,
        orgId: opp.orgId,
        projectId: opp.projectId,
        ...(opp.solicitationNumber ? { solicitationNumber: opp.solicitationNumber } : {}),
        ...(opp.title ? { title: opp.title } : {}),
      },
    ];
  });
