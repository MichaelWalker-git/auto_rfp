import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants';

/**
 * Lifecycle of the automatic FOIA request for a single opportunity.
 *
 * Levels (see docs): Level 1 is the daily award-email scrape, Level 2 is the
 * timer based on the submission date, Level 3 is the manual fallback. The
 * failure states below are what make Level 3 discoverable — an opportunity that
 * never got a FOIA carries a visible reason why.
 */
export const FoiaAutomationStateSchema = z.enum([
  /** Evaluated, but there is no basis to schedule (no submission and no response deadline). */
  'NOT_APPLICABLE',
  /** Clock running — the "pre-send" marker. */
  'SCHEDULED',
  /** Due, but cannot proceed. See `blockedReason`. Failure marker. */
  'BLOCKED',
  /** Draft prepared, waiting on the configured approver. "Pre-send" marker. */
  'AWAITING_APPROVAL',
  /** Approval overdue past `stallAfterDays`. Failure marker. */
  'STALLED',
  /** Transient lock held across the SES call, so a send can never be duplicated. */
  'SENDING',
  /** Delivered to SES — the "post-send" marker. */
  'SENT',
  /** SES reported a hard bounce or complaint. Failure marker. */
  'BOUNCED',
  /** Send errored past the retry cap. Failure marker. */
  'FAILED',
  /** Solicitation cancelled, proposal withdrawn, or a user cancelled automation. */
  'SUPPRESSED',
  /** A human filed the request outside automation (Level 3 succeeded). */
  'MANUAL_COMPLETED',
]);

export type FoiaAutomationState = z.infer<typeof FoiaAutomationStateSchema>;

/**
 * What came back from the agency — a different axis from the request lifecycle.
 *
 * `FoiaAutomationState` says where the request is (scheduled, sent, bounced);
 * this says what the agency did about it. `SENT` tells you nothing about whether
 * records arrived.
 *
 * Recorded at ingestion because most of it is observable nowhere else.
 * `NO_RECORDS_LOCATED` in particular exists only in the agency's reply — it is
 * how we learn a solicitation we thought we bid was one the agency has no record
 * of us bidding, which happened on a real request. If ingestion does not capture
 * it as it arrives, nothing downstream can reconstruct it later.
 */
export const FoiaResponseOutcomeSchema = z.enum([
  /** The agency produced responsive documents. */
  'RECORDS_RECEIVED',
  /** The agency searched and found no record of our participation. */
  'NO_RECORDS_LOCATED',
  /** Withheld in whole or in part, or referred to an AG for a ruling. */
  'DENIED',
  /** The agency acknowledged the request but has not yet produced anything. */
  'ACKNOWLEDGED',
]);

export type FoiaResponseOutcome = z.infer<typeof FoiaResponseOutcomeSchema>;

/**
 * Human-readable labels for what an agency did.
 *
 * "No records held for us" rather than a bare "no records located": the agency did
 * search, and the finding is about our participation specifically — one real reply read
 * "no record of Horus Technology's participation in this solicitation was located".
 * Shortening that to "no records" reads as a missing value rather than an answer.
 */
export const FOIA_RESPONSE_OUTCOME_LABELS: Record<FoiaResponseOutcome, string> = {
  RECORDS_RECEIVED: 'Records received',
  NO_RECORDS_LOCATED: 'No records held for us',
  DENIED: 'Denied or withheld',
  ACKNOWLEDGED: 'Acknowledged, awaiting records',
};

/**
 * Why an automation was suppressed.
 *
 * `SUPPRESSED` alone conflates causes that mean opposite things: a cancelled
 * solicitation is an outcome of the procurement, while a user opting out is a
 * choice about our own process. Anything counting cancellations needs to tell
 * them apart, and the distinction is only known at the moment of suppression.
 */
export const FoiaSuppressionReasonSchema = z.enum([
  /** The agency cancelled the solicitation; no award will follow. */
  'SOLICITATION_CANCELLED',
  /** We withdrew our proposal. */
  'PROPOSAL_WITHDRAWN',
  /** A user turned automation off for this opportunity. */
  'USER_CANCELLED',
  /** The opportunity is no longer eligible (status moved away from WON/LOST). */
  'NO_LONGER_ELIGIBLE',
]);

export type FoiaSuppressionReason = z.infer<typeof FoiaSuppressionReasonSchema>;

/** Why a due automation could not proceed. */
export const FoiaBlockedReasonSchema = z.enum([
  /** All recipient resolution tiers came up empty. */
  'NEEDS_RECIPIENT',
  /** The document scan found candidate addresses; a human must pick one. */
  'NEEDS_CONFIRMATION',
  /**
   * We could not tell which agency this office belongs to. Distinct from
   * NEEDS_RECIPIENT: the UI answers this with an agency picker over the FOIA.gov
   * directory rather than an email field.
   */
  'NEEDS_AGENCY_MATCH',
  /** The agency is on file but does not accept email submissions. */
  'AGENCY_REQUIRES_PORTAL',
  /** `validateLetterFields` found gaps that could not be derived. */
  'MISSING_LETTER_FIELDS',
  /** No approver could be resolved for the organization. */
  'NO_APPROVER',
  /** The org's daily send cap was reached; retried on the next pass. */
  'DAILY_CAP_REACHED',
]);

export type FoiaBlockedReason = z.infer<typeof FoiaBlockedReasonSchema>;

/**
 * Which tier of the recipient fallback chain produced the address.
 * Persisted on every request so an audit can answer "why did this letter go there".
 */
export const FoiaRecipientSourceSchema = z.enum([
  /** `opportunity.foiaContactEmail` — an explicit FOIA-office override. */
  'OPP_FOIA_OVERRIDE',
  /** `opportunity.contactEmail` — auto-populated by the solicitation import. */
  'OPP_CONTACT',
  /** Scraped from the solicitation document text and confirmed by a human. */
  'DOCUMENT_SEARCH',
  /** The organization's reusable agency directory. */
  'ORG_AGENCY_CONTACT',
  /** Typed in by a user in response to a block. */
  'USER_PROVIDED',
  /** Matched against the mirrored FOIA.gov agency-component directory. */
  'FOIA_GOV',
  /** Matched via a HigherGov agency hierarchy walk, then FOIA.gov. */
  'HIGHERGOV_HIERARCHY',
]);

export type FoiaRecipientSource = z.infer<typeof FoiaRecipientSourceSchema>;

/**
 * Recipient sources whose address may be transmitted without a human clicking
 * approve.
 *
 * The distinction is provenance, not confidence score. These four are either
 * published by the government itself (FOIA.gov, directly or via a hierarchy
 * walk) or were entered/confirmed by a person:
 *
 *  - FOIA_GOV / HIGHERGOV_HIERARCHY — the agency's own published FOIA mailbox
 *  - ORG_AGENCY_CONTACT — a human confirmed this agency's address previously
 *  - OPP_FOIA_OVERRIDE / USER_PROVIDED — a human typed it for this opportunity
 *
 * Deliberately excluded:
 *  - DOCUMENT_SEARCH — a regex hit in solicitation text, i.e. an inference
 *  - OPP_CONTACT — the contracting officer from the feed, who is usually NOT the
 *    FOIA office; fine as a fallback a human eyeballs, wrong to mail unattended
 */
export const TRUSTED_FOIA_RECIPIENT_SOURCES = [
  'FOIA_GOV',
  'HIGHERGOV_HIERARCHY',
  'ORG_AGENCY_CONTACT',
  'OPP_FOIA_OVERRIDE',
  'USER_PROVIDED',
] as const satisfies readonly FoiaRecipientSource[];

/** Whether an address from this source may be sent without human approval. */
export const isTrustedFoiaRecipientSource = (
  source: FoiaRecipientSource | null | undefined,
): boolean =>
  !!source && (TRUSTED_FOIA_RECIPIENT_SOURCES as readonly string[]).includes(source);

/** What caused the automation to be scheduled or advanced. */
export const FoiaTriggerSchema = z.enum(['TIMER', 'AWARD_EMAIL', 'MANUAL']);

export type FoiaTrigger = z.infer<typeof FoiaTriggerSchema>;

/** Human-readable labels, mirroring OPPORTUNITY_STATUS_LABELS. */
export const FOIA_AUTOMATION_STATE_LABELS: Record<FoiaAutomationState, string> = {
  NOT_APPLICABLE: 'No FOIA scheduled',
  SCHEDULED: 'FOIA scheduled',
  BLOCKED: 'FOIA needs input',
  AWAITING_APPROVAL: 'FOIA awaiting approval',
  STALLED: 'FOIA approval overdue',
  SENDING: 'FOIA sending',
  SENT: 'FOIA sent',
  BOUNCED: 'FOIA bounced',
  FAILED: 'FOIA send failed',
  SUPPRESSED: 'FOIA not needed',
  MANUAL_COMPLETED: 'FOIA filed manually',
};

/** Tailwind badge classes, mirroring OPPORTUNITY_STATUS_COLORS. */
export const FOIA_AUTOMATION_STATE_COLORS: Record<FoiaAutomationState, string> = {
  NOT_APPLICABLE: 'bg-slate-100 text-slate-600 border-slate-200',
  SCHEDULED: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  BLOCKED: 'bg-amber-50 text-amber-800 border-amber-200',
  AWAITING_APPROVAL: 'bg-blue-50 text-blue-700 border-blue-200',
  STALLED: 'bg-orange-50 text-orange-800 border-orange-200',
  SENDING: 'bg-blue-50 text-blue-700 border-blue-200',
  SENT: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  BOUNCED: 'bg-red-50 text-red-700 border-red-200',
  FAILED: 'bg-red-50 text-red-700 border-red-200',
  SUPPRESSED: 'bg-slate-100 text-slate-600 border-slate-200',
  MANUAL_COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

/** Human-readable explanation of each block, shown directly to the user. */
export const FOIA_BLOCKED_REASON_LABELS: Record<FoiaBlockedReason, string> = {
  NEEDS_RECIPIENT: 'No FOIA contact could be found for this agency. Add one to continue.',
  NEEDS_CONFIRMATION: 'Possible FOIA contacts were found in the solicitation. Confirm which to use.',
  NEEDS_AGENCY_MATCH: 'Select which agency handles records requests for this office.',
  AGENCY_REQUIRES_PORTAL: 'This agency does not accept email requests. Submit via its portal.',
  MISSING_LETTER_FIELDS: 'The request is missing information needed to generate the letter.',
  NO_APPROVER: 'No approver is configured for this organization.',
  DAILY_CAP_REACHED: 'The daily send limit was reached. This will retry automatically.',
};

/**
 * States that represent a failure the user must act on — the "failure marker"
 * from the feature request. Used for badge emphasis and list filtering.
 */
export const FOIA_FAILURE_STATES = [
  'BLOCKED',
  'STALLED',
  'BOUNCED',
  'FAILED',
] as const satisfies readonly FoiaAutomationState[];

/** States where the automation is still working toward a send ("pre-send"). */
export const FOIA_PENDING_STATES = [
  'SCHEDULED',
  'AWAITING_APPROVAL',
  'SENDING',
] as const satisfies readonly FoiaAutomationState[];

/** States where no further automated action will be taken. */
export const FOIA_TERMINAL_STATES = [
  'SENT',
  'SUPPRESSED',
  'MANUAL_COMPLETED',
  'NOT_APPLICABLE',
] as const satisfies readonly FoiaAutomationState[];

export const isFoiaFailureState = (state: FoiaAutomationState): boolean =>
  (FOIA_FAILURE_STATES as readonly FoiaAutomationState[]).includes(state);

export const isFoiaPendingState = (state: FoiaAutomationState): boolean =>
  (FOIA_PENDING_STATES as readonly FoiaAutomationState[]).includes(state);

/** A candidate FOIA address found by scanning solicitation document text. */
export const FoiaRecipientCandidateSchema = z.object({
  email: z.string().email(),
  /** Surrounding text the address was found in, so a user can judge it. */
  context: z.string().max(500),
  /** Higher is a better match. Relative within one scan only. */
  score: z.number(),
  /** Which solicitation document it came from. */
  sourceFileName: z.string().optional(),
});

export type FoiaRecipientCandidate = z.infer<typeof FoiaRecipientCandidateSchema>;

/**
 * An artifact persisted for a sent (or prepared) FOIA request.
 * Keys are relative to DOCUMENTS_BUCKET.
 */
export const FoiaArtifactSchema = z.object({
  kind: z.enum(['LETTER_TXT', 'LETTER_PDF', 'EML', 'AGENCY_RESPONSE']),
  s3Key: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime({ offset: true }),
  /** Set for AGENCY_RESPONSE uploads. */
  uploadedBy: z.string().optional(),
});

export type FoiaArtifact = z.infer<typeof FoiaArtifactSchema>;

// ─── 1. Create request ────────────────────────────────────────────────────────

/**
 * Seeds an automation record. Normally called by the system (on proposal
 * submission or by the reconciling scanner), not by a user.
 */
export const FoiaAutomationCreateRequestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  state: FoiaAutomationStateSchema,
  scheduledSendAt: z.string().datetime({ offset: true }).nullish(),
  delayDaysOverride: z.number().int().min(0).max(3650).nullish(),
  triggeredBy: FoiaTriggerSchema.default('TIMER'),
});

export type FoiaAutomationCreateRequest = z.infer<typeof FoiaAutomationCreateRequestSchema>;

// ─── 2. Update request ────────────────────────────────────────────────────────

/**
 * The user-patchable surface. Deliberately narrow: state transitions are driven
 * by the scanner and the send path via conditional writes, never by a client
 * PATCH, so `state` is not patchable here. `cancel` and `markManualCompleted`
 * are the two state changes a user may request, and the handler maps them to
 * SUPPRESSED / MANUAL_COMPLETED.
 */
export const FoiaAutomationUpdateRequestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  /** Per-opportunity override of the org's `delayDays`. Null clears it. */
  delayDaysOverride: z.number().int().min(0).max(3650).nullish(),
  /** Explicitly reschedule. Used by "snooze". */
  scheduledSendAt: z.string().datetime({ offset: true }).nullish(),
  /** Stop automating this opportunity. */
  cancel: z.boolean().optional(),
  /** Record that a human filed the request outside the app. */
  markManualCompleted: z.boolean().optional(),
});

export type FoiaAutomationUpdateRequest = z.infer<typeof FoiaAutomationUpdateRequestSchema>;

// ─── 3. Item ──────────────────────────────────────────────────────────────────

export const FoiaAutomationItemSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),

  state: FoiaAutomationStateSchema,
  /** When the automation should (or did) become due. */
  scheduledSendAt: z.string().datetime({ offset: true }).nullish(),
  /** Per-opportunity override of the org default delay. */
  delayDaysOverride: z.number().int().min(0).max(3650).nullish(),
  triggeredBy: FoiaTriggerSchema.optional(),
  /**
   * The date the schedule is counted from, when it is NOT the submission date.
   *
   * Set when an agency's award notice arrives and re-anchors the timer to the real award
   * date. Persisted because the nightly reconciler recomputes `scheduledSendAt` from
   * `submittedAt` and `responseDeadlineIso` and overwrites anything that disagrees — so
   * without this the re-anchor survived only until the next pass, at most 24 hours, and
   * the Level-1 behaviour of "start counting from the award, not the deadline" silently
   * reverted with nothing recording that it had.
   *
   * The reconciler prefers this over `submittedAt` when present, which makes its recompute
   * land on the same value rather than a competing one. Deliberately NOT a skip-guard on
   * the reconciler: it must stay free to re-derive the schedule when `delayDays` changes.
   */
  awardAnchorAt: z.string().datetime({ offset: true }).nullish(),
  /**
   * Stamped the first time `scheduledSendAt` passed. Distinguishes a failure
   * *before* the Level-2 window from one *after* it, which is the pre/post
   * distinction the feature request asks for.
   */
  becameDueAt: z.string().datetime({ offset: true }).nullish(),

  blockedReason: FoiaBlockedReasonSchema.nullish(),
  /** Populated when blockedReason is MISSING_LETTER_FIELDS. */
  missingFields: z.array(z.string()).optional(),

  /** The resolved agency address, once known. */
  resolvedRecipientEmail: z.string().email().nullish(),
  resolvedRecipientAddress: z.string().nullish(),
  recipientSource: FoiaRecipientSourceSchema.nullish(),
  /** Populated when blockedReason is NEEDS_CONFIRMATION. */
  recipientCandidates: z.array(FoiaRecipientCandidateSchema).optional(),

  /** The FOIA request record this automation created, once prepared. */
  foiaRequestId: z.string().nullish(),

  /**
   * Whether this request may be transmitted without a human click.
   *
   * True only when the recipient came from a trusted source AND the org has
   * enabled `autoSendTrusted` AND the award date provenance is verified. Set by
   * the scanner when preparing the request; consumed by the send worker (once it
   * exists) or by the UI to skip showing the approval screen.
   */
  autoSendEligible: z.boolean().nullish(),

  approvalId: z.string().nullish(),
  approvalRequestedAt: z.string().datetime({ offset: true }).nullish(),
  /** ISO timestamps of reminder emails already sent, to avoid re-sending. */
  remindersSentAt: z.array(z.string().datetime({ offset: true })).optional(),
  stalledAt: z.string().datetime({ offset: true }).nullish(),

  sentAt: z.string().datetime({ offset: true }).nullish(),
  sesMessageId: z.string().nullish(),
  bounceReason: z.string().nullish(),

  attemptCount: z.number().int().nonnegative().default(0),
  lastAttemptAt: z.string().datetime({ offset: true }).nullish(),
  lastError: z.string().nullish(),

  /** Human-readable note. Kept for display; prefer `suppressionReason` to count on. */
  suppressedReason: z.string().nullish(),
  /**
   * Typed cause of suppression. Distinguishes an agency cancelling a solicitation
   * from a user opting out — opposite meanings that `SUPPRESSED` alone conflates,
   * and only knowable at the moment of suppression.
   */
  suppressionReason: FoiaSuppressionReasonSchema.nullish(),

  /**
   * What the agency did about the request, as opposed to where the request is.
   *
   * Set from the agency's reply at ingestion. `NO_RECORDS_LOCATED` is observable
   * nowhere else — it is how we learn the agency has no record of us bidding a
   * solicitation we believed we bid, which happened on a real request.
   */
  responseOutcome: FoiaResponseOutcomeSchema.nullish(),
  responseReceivedAt: z.string().datetime({ offset: true }).nullish(),
  /** The agency's own tracking number, for following up by reference. */
  agencyTrackingNumber: z.string().nullish(),

  artifacts: z.array(FoiaArtifactSchema).optional(),

  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  updatedBy: z.string().optional(),
});

export type FoiaAutomationItem = z.infer<typeof FoiaAutomationItemSchema>;

// ─── 4. DB item ───────────────────────────────────────────────────────────────

export const FoiaAutomationDBItemSchema = FoiaAutomationItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});

export type FoiaAutomationDBItem = z.infer<typeof FoiaAutomationDBItemSchema>;

// ─── 5. List item ─────────────────────────────────────────────────────────────

export const FoiaAutomationListItemSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  state: FoiaAutomationStateSchema,
  scheduledSendAt: z.string().nullish(),
  blockedReason: FoiaBlockedReasonSchema.nullish(),
  sentAt: z.string().nullish(),
});

export type FoiaAutomationListItem = z.infer<typeof FoiaAutomationListItemSchema>;

// ─── Scheduling ───────────────────────────────────────────────────────────────

/** Default delay between the submission anchor and the FOIA send. */
export const DEFAULT_FOIA_DELAY_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Computes when the automatic FOIA should be sent.
 *
 * The anchor is the real submission date when we have one, because the feature
 * is "automatic FOIA post submission". We fall back to the solicitation's
 * response deadline for opportunities tracked without going through the in-app
 * submit flow. With neither, there is no basis to schedule.
 *
 * Pure and UTC-only: a delay measured in days has no wall-clock or DST
 * sensitivity, and the scanner's due test is `scheduledSendAt <= now`, so no
 * window matching is involved.
 *
 * @returns an ISO-8601 timestamp, or null when the automation is not applicable.
 */
export const computeFoiaScheduledSendAt = (args: {
  submittedAt?: string | null;
  responseDeadlineIso?: string | null;
  delayDays: number;
}): string | null => {
  const { submittedAt, responseDeadlineIso, delayDays } = args;

  const anchor = firstValidDate([submittedAt, responseDeadlineIso]);
  if (anchor === null) return null;

  if (!Number.isFinite(delayDays) || delayDays < 0) return null;

  return new Date(anchor + delayDays * MS_PER_DAY).toISOString();
};

/** Returns the epoch ms of the first parseable date, or null if none parse. */
const firstValidDate = (candidates: Array<string | null | undefined>): number | null => {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const ms = new Date(candidate).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  return null;
};

/**
 * Opportunity outcomes that justify a records request.
 *
 * Both wins and losses qualify: a loss wants the evaluation record, and a win
 * wants the competitors' pricing and the source-selection rationale. Bids that
 * were never made (NO_BID, WITHDRAWN) have no evaluation record to request.
 */
export const FOIA_ELIGIBLE_OPPORTUNITY_STATUSES = ['WON', 'LOST'] as const;

export const isFoiaEligibleStatus = (status: string | undefined | null): boolean =>
  !!status && (FOIA_ELIGIBLE_OPPORTUNITY_STATUSES as readonly string[]).includes(status);
