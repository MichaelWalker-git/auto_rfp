/**
 * ACE submission state machine — the "advance to Technical Validation" bot.
 *
 * AWS Partner Central will not let us set an opportunity's stage to
 * 'Technical Validation' directly: a freshly created opp is locked at
 * Prospect / ReviewStatus=`Pending Submission`, and the stage only becomes
 * editable after the opp is submitted to AWS review and AWS *approves* it. That
 * walk is asynchronous (hours–days) and can be rejected. So there is no single
 * synchronous call — instead each opportunity carries an `aceSubmission` record
 * and a scheduled poller advances it ONE step per tick:
 *
 *   NONE
 *     └─ startAceSubmission ─▶ StartEngagementFromOpportunityTask
 *   ENGAGEMENT_PENDING ── poll task ──▶ COMPLETE ▶ ENGAGED   (FAILED ▶ FAILED)
 *   ENGAGED            ── SubmitOpportunity ─────▶ SUBMITTED
 *   SUBMITTED/IN_REVIEW ─ poll ReviewStatus ────▶ IN_REVIEW / ACTION_REQUIRED
 *                                                 / APPROVED / REJECTED
 *   APPROVED           ── UpdateOpportunity ─────▶ ADVANCED  (stage set locally)
 *   ADVANCED | REJECTED | FAILED                    terminal
 *   ACTION_REQUIRED                                 paused (surfaced to a human)
 *
 * Safety: the whole bot is OFF unless `ACE_SUBMISSION_ENABLED=true`, and the
 * catalog defaults to production `AWS` but honors `APN_SUBMISSION_CATALOG=Sandbox`
 * so the lifecycle can be exercised end-to-end against Sandbox first. Every step
 * is idempotent and NEVER throws — a failure is caught, recorded on the record,
 * and the poller moves on.
 */

import { nowIso } from '@/helpers/date';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';
import { setAceStageLocal } from '@/helpers/ace-stage';
import type {
  AceSubmission,
  AceSubmissionState,
  OpportunityItem,
} from '@auto-rfp/core';

/** Reason a step declined to act (no state change happened). */
export type AceSubmissionStepOutcome =
  | AceSubmissionState // moved to (or stayed at) this state after acting
  | 'disabled' // ACE_SUBMISSION_ENABLED is not true
  | 'no-apn-id' // opportunity has no Partner Central id yet
  | 'not-found' // opportunity record missing
  | 'noop'; // terminal/paused state — nothing to do

/** Feature flag: the bot only acts when this is exactly 'true'. */
export const isAceSubmissionEnabled = (): boolean =>
  process.env['ACE_SUBMISSION_ENABLED'] === 'true';

/** States the poller should keep stepping. */
const isActiveState = (state: AceSubmissionState): boolean =>
  state !== 'ADVANCED' &&
  state !== 'REJECTED' &&
  state !== 'FAILED' &&
  state !== 'ACTION_REQUIRED';

const truncate = (s: string, n = 500): string => (s.length > n ? s.substring(0, n) : s);

interface Ids {
  orgId: string;
  projectId: string;
  oppId: string;
}

/** Persist the submission sub-record (merged) onto the opportunity item. */
const writeSubmission = async (
  ids: Ids,
  patch: Partial<AceSubmission> & { state: AceSubmissionState },
  prior?: AceSubmission,
): Promise<AceSubmission> => {
  const next: AceSubmission = {
    ...(prior ?? {}),
    ...patch,
    lastStepAt: nowIso(),
  };
  await updateOpportunity({ ...ids, patch: { aceSubmission: next } });
  return next;
};

/**
 * Kick off the submission pipeline for one opportunity: fire
 * StartEngagementFromOpportunityTask and record ENGAGEMENT_PENDING. Idempotent —
 * a no-op if a submission is already underway/terminal, disabled, or the opp has
 * no Partner Central id yet. Never throws.
 */
export const startAceSubmission = async (ids: Ids): Promise<AceSubmissionStepOutcome> => {
  if (!isAceSubmissionEnabled()) return 'disabled';

  try {
    const existing = await getOpportunity(ids);
    if (!existing) return 'not-found';
    const item = existing.item as OpportunityItem;

    const apnId = item.apnOpportunityId;
    if (!apnId) return 'no-apn-id';

    const prior = item.aceSubmission;
    // Only start from a clean slate. Anything already in-flight/terminal is left
    // to the poller (or a human, for ACTION_REQUIRED).
    if (prior && prior.state !== 'NONE') return prior.state;

    const { startEngagementFromOpportunity } = await import('@/helpers/apn-client');
    const result = await startEngagementFromOpportunity({
      orgId: ids.orgId,
      oppId: ids.oppId,
      apnOpportunityId: apnId,
    });

    // The task may complete synchronously (rare) — capture the engagementId if so.
    const engaged = result.taskStatus === 'COMPLETE' && result.engagementId;
    await writeSubmission(
      ids,
      {
        state: engaged ? 'ENGAGED' : 'ENGAGEMENT_PENDING',
        taskId: result.taskId,
        engagementId: result.engagementId,
        error: null,
        attempts: 0,
      },
      prior,
    );
    return engaged ? 'ENGAGED' : 'ENGAGEMENT_PENDING';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ace-submission] startAceSubmission failed oppId=${ids.oppId}:`, message);
    // Record the failure but keep it recoverable (NONE) so a later tick retries.
    try {
      await writeSubmission(ids, { state: 'NONE', error: truncate(message) });
    } catch { /* best-effort */ }
    return 'noop';
  }
};

/**
 * Advance ONE opportunity by one step. Reads the current aceSubmission state and
 * takes exactly the next action. Idempotent and never throws. Returns the state
 * after the step (or a decline reason).
 */
export const stepAceSubmission = async (ids: Ids): Promise<AceSubmissionStepOutcome> => {
  if (!isAceSubmissionEnabled()) return 'disabled';

  try {
    const existing = await getOpportunity(ids);
    if (!existing) return 'not-found';
    const item = existing.item as OpportunityItem;

    const apnId = item.apnOpportunityId;
    if (!apnId) return 'no-apn-id';

    const prior = item.aceSubmission;
    // Nothing started yet: begin the pipeline.
    if (!prior || prior.state === 'NONE') return startAceSubmission(ids);

    if (!isActiveState(prior.state)) return 'noop';

    const apn = await import('@/helpers/apn-client');
    const attempts = (prior.attempts ?? 0) + 1;

    switch (prior.state) {
      case 'ENGAGEMENT_PENDING': {
        if (!prior.taskId) {
          // Stranded without a task to poll (an earlier start recorded the state
          // but lost the TaskId) — re-fire the engagement in place. Idempotent
          // via the ClientToken, so this reattaches rather than duplicates.
          const result = await apn.startEngagementFromOpportunity({
            orgId: ids.orgId,
            oppId: ids.oppId,
            apnOpportunityId: apnId,
          });
          const engaged = result.taskStatus === 'COMPLETE' && result.engagementId;
          await writeSubmission(
            ids,
            {
              state: engaged ? 'ENGAGED' : 'ENGAGEMENT_PENDING',
              taskId: result.taskId,
              engagementId: result.engagementId,
              error: null,
              attempts: engaged ? 0 : attempts,
            },
            prior,
          );
          return engaged ? 'ENGAGED' : 'ENGAGEMENT_PENDING';
        }
        const status = await apn.getEngagementTaskStatus({
          taskId: prior.taskId,
          apnOpportunityId: apnId,
        });
        if (status.taskStatus === 'COMPLETE') {
          await writeSubmission(
            ids,
            { state: 'ENGAGED', engagementId: status.engagementId, error: null, attempts: 0 },
            prior,
          );
          return 'ENGAGED';
        }
        if (status.taskStatus === 'FAILED') {
          await writeSubmission(
            ids,
            { state: 'FAILED', error: truncate(status.message ?? 'Engagement task failed') },
            prior,
          );
          return 'FAILED';
        }
        // Still IN_PROGRESS.
        await writeSubmission(ids, { state: 'ENGAGEMENT_PENDING', attempts }, prior);
        return 'ENGAGEMENT_PENDING';
      }

      case 'ENGAGED': {
        await apn.submitOpportunityForReview({ apnOpportunityId: apnId });
        await writeSubmission(ids, { state: 'SUBMITTED', error: null, attempts: 0 }, prior);
        return 'SUBMITTED';
      }

      case 'SUBMITTED':
      case 'IN_REVIEW': {
        const snap = await apn.getOpportunityReviewSnapshot({ apnOpportunityId: apnId });
        const review = snap.reviewStatus;
        const comments = snap.reviewComments ?? snap.reviewStatusReason;

        if (review === 'Approved') {
          await writeSubmission(
            ids,
            { state: 'APPROVED', reviewStatus: review, reviewComments: comments, error: null, attempts: 0 },
            prior,
          );
          return 'APPROVED';
        }
        if (review === 'Rejected') {
          await writeSubmission(
            ids,
            { state: 'REJECTED', reviewStatus: review, reviewComments: comments },
            prior,
          );
          return 'REJECTED';
        }
        if (review === 'Action Required') {
          await writeSubmission(
            ids,
            { state: 'ACTION_REQUIRED', reviewStatus: review, reviewComments: comments },
            prior,
          );
          return 'ACTION_REQUIRED';
        }
        // Still 'Submitted' or 'In review' — record whichever AWS reports.
        const nextState: AceSubmissionState = review === 'In review' ? 'IN_REVIEW' : 'SUBMITTED';
        await writeSubmission(ids, { state: nextState, reviewStatus: review, attempts }, prior);
        return nextState;
      }

      case 'APPROVED': {
        await apn.advanceOpportunityStage({
          orgId: ids.orgId,
          projectId: ids.projectId,
          oppId: ids.oppId,
          apnOpportunityId: apnId,
          customerName: item.organizationName ?? item.title ?? 'Unknown Customer',
          opportunityTitle: item.title,
          opportunityValue: item.baseAndAllOptionsValue ?? 0,
          expectedCloseDate: item.responseDeadlineIso ?? nowIso(),
          aceStage: 'Technical Validation',
        });
        // Reflect the advance on the local ACE stage axis (idempotent — only
        // appends a transition when the stage actually changes).
        if (item.aceStage !== 'Technical Validation') {
          await setAceStageLocal({
            ...ids,
            to: 'Technical Validation',
            changedBy: 'system',
            source: 'AUTO_SUBMITTED',
          });
        }
        await writeSubmission(ids, { state: 'ADVANCED', error: null, attempts: 0 }, prior);
        return 'ADVANCED';
      }

      default:
        return 'noop';
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ace-submission] stepAceSubmission failed oppId=${ids.oppId}:`, message);
    // Record the error against the current state without advancing; the next
    // tick retries the same step. We do NOT flip to FAILED on a transient API
    // error — only an explicit task/AWS FAILED/Rejected is terminal.
    try {
      const existing = await getOpportunity(ids);
      const prior = (existing?.item as OpportunityItem | undefined)?.aceSubmission;
      if (prior) {
        await writeSubmission(
          ids,
          { state: prior.state, error: truncate(message), attempts: (prior.attempts ?? 0) + 1 },
          prior,
        );
      }
    } catch { /* best-effort */ }
    return 'noop';
  }
};
