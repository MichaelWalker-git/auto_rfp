import type { AceSubmission } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { SK_NAME } from '@/constants/common';
import { buildOpportunitySk, parseOpportunitySk } from '@/helpers/opportunity';
import { queryAllBySkPrefix } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { stepAceSubmission, isAceSubmissionEnabled } from '@/helpers/ace-submission';

/**
 * Scheduled poller — the driver for the ACE "advance to Technical Validation"
 * bot. Each tick scans the RFP inventory for opportunities whose aceSubmission
 * is in a non-terminal, non-paused state and advances each by exactly one step
 * (see helpers/ace-submission.ts for the state machine).
 *
 * Because the AWS Partner Central lifecycle is asynchronous (engagement task
 * completion, then AWS review that can take hours–days), this Lambda is expected
 * to run on a schedule and make incremental progress. Every step is idempotent
 * and never throws, so a partial run or a re-run is always safe.
 *
 * OFF by default: does nothing unless ACE_SUBMISSION_ENABLED=true. The catalog
 * defaults to production `AWS` but honors APN_SUBMISSION_CATALOG=Sandbox so the
 * whole flow can be validated against Sandbox first.
 *
 * Env (shared with the Linear sync stack):
 *   RFP_SYNC_ORG_ID       — target AutoRFP org id
 *   RFP_SYNC_PROJECT_ID   — synthetic project id for these records
 *   ACE_SUBMISSION_ENABLED — 'true' to actually act (else no-op)
 *   APN_SUBMISSION_CATALOG — 'Sandbox' | 'AWS' (defaults to APN_CATALOG='AWS')
 */

const ORG_ID = requireEnv('RFP_SYNC_ORG_ID');
const PROJECT_ID = requireEnv('RFP_SYNC_PROJECT_ID');

/** States the poller no longer needs to touch (terminal or human-paused). */
const INACTIVE_STATES = new Set<AceSubmission['state']>([
  'ADVANCED',
  'REJECTED',
  'FAILED',
  'ACTION_REQUIRED',
]);

/** Minimal shape of a stored opportunity record this poller reads. */
interface OpportunityRecord {
  [SK_NAME]?: string;
  oppId?: string;
  aceSubmission?: AceSubmission;
}

export interface AdvanceAceSummary {
  /** Records with an in-flight submission the poller considered. */
  inFlight: number;
  /** Steps that produced a state change (progress made). */
  advanced: number;
  /** Steps that reached ADVANCED (fully at Technical Validation). */
  completed: number;
  /** Steps that reached a terminal FAILED/REJECTED this run. */
  failed: number;
  /** Steps that made no change (still waiting / no-op). */
  waiting: number;
  /** True when the bot is disabled by feature flag (no work done). */
  disabled: boolean;
}

const oppIdFor = (record: OpportunityRecord): string => {
  if (record.oppId) return record.oppId;
  const sk = record[SK_NAME];
  return typeof sk === 'string' ? parseOpportunitySk(sk).oppId : '';
};

/**
 * Exported for direct unit testing (per project convention — test the business
 * function, not the Lambda wrapper).
 */
export const advanceAceSubmissions = async (): Promise<AdvanceAceSummary> => {
  const summary: AdvanceAceSummary = {
    inFlight: 0,
    advanced: 0,
    completed: 0,
    failed: 0,
    waiting: 0,
    disabled: false,
  };

  if (!isAceSubmissionEnabled()) {
    console.log('[advance-ace-submissions] disabled (ACE_SUBMISSION_ENABLED != true) — no-op');
    summary.disabled = true;
    return summary;
  }

  const skPrefix = buildOpportunitySk(ORG_ID, PROJECT_ID, 'linear-');
  const inventory = await queryAllBySkPrefix<OpportunityRecord>(OPPORTUNITY_PK, skPrefix);

  // Only records with an active (non-terminal, non-paused) submission need work.
  const active = inventory.filter((record) => {
    const state = record.aceSubmission?.state;
    return Boolean(state) && !INACTIVE_STATES.has(state as AceSubmission['state']);
  });
  summary.inFlight = active.length;

  for (const record of active) {
    const oppId = oppIdFor(record);
    if (!oppId) continue;

    const before = record.aceSubmission?.state;
    const outcome = await stepAceSubmission({ orgId: ORG_ID, projectId: PROJECT_ID, oppId });

    if (outcome === 'ADVANCED') {
      summary.completed += 1;
      summary.advanced += 1;
    } else if (outcome === 'FAILED' || outcome === 'REJECTED') {
      summary.failed += 1;
      summary.advanced += 1;
    } else if (outcome !== before && outcome !== 'noop' && outcome !== 'disabled') {
      summary.advanced += 1;
    } else {
      summary.waiting += 1;
    }
  }

  return summary;
};

const baseHandler = async (): Promise<{ statusCode: number; body: string }> => {
  try {
    const summary = await advanceAceSubmissions();
    console.log('[advance-ace-submissions] complete', summary);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...summary }) };
  } catch (err: unknown) {
    console.error('[advance-ace-submissions] failed', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    };
  }
};

export const handler = withSentryLambda(baseHandler);
