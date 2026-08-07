import type { OpportunityApprovalStatus, OpportunityStatus } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { SK_NAME } from '@/constants/common';
import { buildOpportunitySk, parseOpportunitySk } from '@/helpers/opportunity';
import { queryAllBySkPrefix } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { ensureAceTechnicalValidation } from '@/helpers/ace-stage';
import { startAceSubmission } from '@/helpers/ace-submission';

/**
 * One-off backfill: create an ACE (AWS Partner Central) opportunity — advanced
 * to 'Technical Validation' — for every RFP that was marked submitted in the
 * last month and does not already have one.
 *
 * This mirrors the submitted-trigger in sync-linear-pipeline.ts for records that
 * crossed into submitted BEFORE that trigger existed. It is manually invoked (no
 * schedule) and safe to re-run: ensureAceTechnicalValidation is idempotent (an
 * opp already at 'Technical Validation' is skipped, and the Partner Central push
 * is keyed on `${orgId}-${oppId}` so it never duplicates the PC opportunity).
 *
 * Reuses the same org/project the Linear sync writes under (RFP_SYNC_ORG_ID /
 * RFP_SYNC_PROJECT_ID) and the same inventory query, so it operates on exactly
 * the records the board shows.
 *
 * Env (shared with the sync Lambda's stack):
 *   RFP_SYNC_ORG_ID     — target AutoRFP org id
 *   RFP_SYNC_PROJECT_ID — synthetic project id for these records
 */

const ORG_ID = requireEnv('RFP_SYNC_ORG_ID');
const PROJECT_ID = requireEnv('RFP_SYNC_PROJECT_ID');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;

/** Optional overrides for the look-back window. `sinceIso` wins over `days`. */
export interface BackfillAceSubmittedArgs {
  /** Explicit ISO cutoff — only opps with completedAt >= this are considered. */
  sinceIso?: string;
  /** Look-back window in days (default 30). Ignored when sinceIso is set. */
  days?: number;
}

export interface BackfillAceSummary {
  scanned: number;
  created: number;
  advanced: number;
  skipped: number;
  errors: number;
  sinceIso: string;
}

/** Minimal shape of a stored opportunity record this backfill reads. */
interface OpportunityRecord {
  [SK_NAME]?: string;
  oppId?: string;
  status?: OpportunityStatus;
  approvalStatus?: OpportunityApprovalStatus;
  completedAt?: string | null;
  aceStage?: string;
}

const resolveCutoffMs = (args: BackfillAceSubmittedArgs): number => {
  if (args.sinceIso) {
    const parsed = Date.parse(args.sinceIso);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const days = Number.isFinite(args.days) && (args.days ?? 0) > 0 ? (args.days as number) : DEFAULT_DAYS;
  return Date.now() - days * DAY_MS;
};

/**
 * A record qualifies for backfill when it is submitted (on either axis) and
 * closed within the window. The completedAt gate keeps the backfill to "last
 * month's" submissions and avoids re-touching the whole terminal archive.
 */
const isRecentSubmitted = (record: OpportunityRecord, cutoffMs: number): boolean => {
  const isSubmitted = record.status === 'SUBMITTED' || record.approvalStatus === 'SUBMITTED';
  if (!isSubmitted) return false;
  if (!record.completedAt) return false;
  const closed = Date.parse(record.completedAt);
  return !Number.isNaN(closed) && closed >= cutoffMs;
};

const oppIdFor = (record: OpportunityRecord): string => {
  if (record.oppId) return record.oppId;
  const sk = record[SK_NAME];
  return typeof sk === 'string' ? parseOpportunitySk(sk).oppId : '';
};

/**
 * Exported for direct unit testing (per project convention — test the business
 * function, not the Lambda wrapper).
 */
export const backfillAceSubmitted = async (
  args: BackfillAceSubmittedArgs = {},
): Promise<BackfillAceSummary> => {
  const cutoffMs = resolveCutoffMs(args);
  const sinceIso = new Date(cutoffMs).toISOString();

  const skPrefix = buildOpportunitySk(ORG_ID, PROJECT_ID, 'linear-');
  const inventory = await queryAllBySkPrefix<OpportunityRecord>(OPPORTUNITY_PK, skPrefix);

  const candidates = inventory.filter((record) => isRecentSubmitted(record, cutoffMs));

  let created = 0;
  let advanced = 0;
  let skipped = 0;
  let errors = 0;

  for (const record of candidates) {
    const oppId = oppIdFor(record);
    if (!oppId) {
      errors += 1;
      continue;
    }

    const outcome = await ensureAceTechnicalValidation({
      orgId: ORG_ID,
      projectId: PROJECT_ID,
      oppId,
    });

    if (outcome === 'created') created += 1;
    else if (outcome === 'advanced') advanced += 1;
    else if (outcome === 'skipped') skipped += 1;
    else errors += 1;

    // Also kick off the async submit→AWS-review→advance bot (flag-gated, no-op
    // when disabled; idempotent so re-runs never restart an in-flight submission).
    await startAceSubmission({ orgId: ORG_ID, projectId: PROJECT_ID, oppId });
  }

  return { scanned: candidates.length, created, advanced, skipped, errors, sinceIso };
};

const baseHandler = async (
  event: BackfillAceSubmittedArgs = {},
): Promise<{ statusCode: number; body: string }> => {
  try {
    const summary = await backfillAceSubmitted(event ?? {});
    console.log('ACE submitted backfill complete', summary);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...summary }) };
  } catch (err: unknown) {
    console.error('ACE submitted backfill failed', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    };
  }
};

export const handler = withSentryLambda(baseHandler);
