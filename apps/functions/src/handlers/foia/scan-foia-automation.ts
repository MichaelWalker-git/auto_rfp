import middy from '@middy/core';

import {
  FoiaRecipientSourceSchema,
  computeFoiaScheduledSendAt,
  isFoiaEligibleStatus,
  type FoiaAutomationDBItem,
  type FoiaAutomationState,
  type FoiaSettingsItem,
  type OpportunityDBItem,
} from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { nowIso } from '@/helpers/date';
import { listAllOrgIds } from '@/helpers/org';
import { listOpportunitiesByOrg } from '@/helpers/opportunity';
import { getSubmissionHistory } from '@/helpers/proposal-submission';
import { getFoiaSettings } from '@/helpers/foia-settings';
import {
  getFoiaAutomation,
  setFoiaAutomationState,
  syncOpportunityFoiaMarker,
  transitionFoiaAutomationState,
  upsertFoiaAutomation,
} from '@/helpers/foia-automation';
import { prepareFoiaRequest } from '@/helpers/foia-prepare';

/**
 * Daily reconciler for automatic FOIA requests (Level 2).
 *
 * This is deliberately a RECONCILER, not a one-shot timer. On every pass it
 * recomputes the intended state of every eligible opportunity from current
 * inputs, which buys several properties that a fire-once design does not have:
 *
 *  - no backfill migration is needed for opportunities that already exist;
 *  - a missed write-time hook self-corrects within 24 hours;
 *  - changing the org's delay, editing a deadline, or withdrawing a submission
 *    is picked up automatically;
 *  - the denormalized marker on the opportunity is re-synced each pass, so
 *    display drift heals itself.
 *
 * Because it is idempotent, an incomplete pass is always safe to repeat.
 *
 * NOTE: this phase stops at SCHEDULED / NOT_APPLICABLE / SUPPRESSED. Preparing
 * the letter, resolving the recipient and requesting approval arrive with the
 * send path; nothing here transmits email.
 */

/** States the reconciler is allowed to overwrite. Anything else is left alone. */
const RECONCILABLE_STATES: readonly FoiaAutomationState[] = [
  'NOT_APPLICABLE',
  'SCHEDULED',
];

interface ScanEventDetail {
  /** Compute and report, but persist nothing. */
  dryRun?: boolean;
  /** Restrict the pass to a single org, for manual invocation. */
  orgId?: string;
}

interface ScanEvent {
  detail?: ScanEventDetail;
}

interface OrgScanResult {
  orgId: string;
  scheduled: number;
  notApplicable: number;
  suppressed: number;
  unchanged: number;
  skipped: number;
  errors: number;
  /** Due requests composed and advanced to AWAITING_APPROVAL. */
  prepared: number;
  /** Due requests that need human input before they can proceed. */
  blocked: number;
}

/** A zeroed result, so every construction site stays in sync. */
const emptyResult = (orgId: string): OrgScanResult => ({
  orgId,
  scheduled: 0,
  notApplicable: 0,
  suppressed: 0,
  unchanged: 0,
  skipped: 0,
  errors: 0,
  prepared: 0,
  blocked: 0,
});

/** What the reconciler decided an opportunity's automation should look like. */
interface Intent {
  state: FoiaAutomationState;
  scheduledSendAt: string | null;
  suppressedReason?: string;
}

/**
 * Decides the intended automation state for one opportunity.
 *
 * Pure apart from the submission lookup, so the decision table stays readable:
 *   not WON/LOST                 → NOT_APPLICABLE (nothing to request yet)
 *   submission withdrawn         → SUPPRESSED
 *   no submission and no deadline→ NOT_APPLICABLE (no basis for a clock)
 *   otherwise                    → SCHEDULED at anchor + delay
 */
const decideIntent = async (args: {
  opportunity: OpportunityDBItem;
  settings: FoiaSettingsItem;
  delayDaysOverride?: number | null;
}): Promise<Intent> => {
  const { opportunity, settings, delayDaysOverride } = args;
  const { orgId, projectId, oppId } = opportunity;

  if (!isFoiaEligibleStatus(opportunity.status)) {
    return { state: 'NOT_APPLICABLE', scheduledSendAt: null };
  }

  // A submission record is the preferred clock anchor — the feature is
  // "automatic FOIA post submission".
  let submittedAt: string | null = null;
  if (orgId && projectId && oppId) {
    const history = await getSubmissionHistory(orgId, projectId, oppId);
    const active = history.find((entry) => entry.status === 'SUBMITTED');

    // Every submission withdrawn means there is no proposal to ask about.
    if (!active && history.length > 0) {
      return {
        state: 'SUPPRESSED',
        scheduledSendAt: null,
        suppressedReason: 'Proposal submission was withdrawn',
      };
    }

    submittedAt = active?.submittedAt ?? null;
  }

  const delayDays = delayDaysOverride ?? settings.delayDays;

  const scheduledSendAt = computeFoiaScheduledSendAt({
    submittedAt,
    responseDeadlineIso: opportunity.responseDeadlineIso ?? null,
    delayDays,
  });

  if (!scheduledSendAt) {
    // Neither a submission nor a response deadline — nothing to count from.
    return { state: 'NOT_APPLICABLE', scheduledSendAt: null };
  }

  return { state: 'SCHEDULED', scheduledSendAt };
};

/** True when the stored record already matches the intent. */
const matchesIntent = (existing: FoiaAutomationDBItem | null, intent: Intent): boolean =>
  !!existing &&
  existing.state === intent.state &&
  (existing.scheduledSendAt ?? null) === intent.scheduledSendAt;

/**
 * True when a scheduled timestamp has arrived.
 *
 * A plain `<= now` comparison rather than a window match: an exact-window scanner
 * silently skips anything it misses (a failed run, a clock skew), which for a
 * months-long timer means the FOIA simply never fires. Treating "past due" as due
 * makes a missed night self-correcting.
 */
const isDue = (scheduledSendAt: string | null, now: number = Date.now()): boolean => {
  if (!scheduledSendAt) return false;
  const due = new Date(scheduledSendAt).getTime();
  return !Number.isNaN(due) && due <= now;
};

/**
 * Composes a due request and advances it out of SCHEDULED.
 *
 * The conditional transition happens FIRST, moving the record to a transient
 * PREPARING-equivalent before any artifact is written, so two overlapping scanner
 * runs cannot both compose the same request. Only the run that wins the
 * transition proceeds.
 */
const prepareDueAutomation = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  opportunity: OpportunityDBItem;
  settings: FoiaSettingsItem;
  dryRun: boolean;
}): Promise<'PREPARED' | 'BLOCKED' | 'SKIPPED'> => {
  const { orgId, projectId, oppId, opportunity, settings, dryRun } = args;

  const outcome = await prepareFoiaRequest({
    orgId,
    projectId,
    oppId,
    opportunity,
    settings,
    dryRun,
    // The document scan reads S3 per opportunity; skip it on dry runs so a
    // preview stays cheap and side-effect free.
    skipDocumentScan: dryRun,
  });

  if (dryRun) {
    return outcome.status === 'PREPARED' ? 'PREPARED' : 'BLOCKED';
  }

  if (outcome.status === 'BLOCKED') {
    const moved = await transitionFoiaAutomationState({
      orgId,
      projectId,
      oppId,
      from: 'SCHEDULED',
      to: 'BLOCKED',
      patch: {
        becameDueAt: nowIso(),
        blockedReason: outcome.blockedReason,
        missingFields: outcome.missingFields,
        recipientCandidates: outcome.recipientCandidates,
      },
    });

    if (!moved) return 'SKIPPED';

    await syncOpportunityFoiaMarker(orgId, projectId, oppId, 'BLOCKED');
    return 'BLOCKED';
  }

  /**
   * The scanner NEVER enters SENDING — that state is owned exclusively by the
   * send handler (send-foia-request.ts), which drives the conditional transition
   * AWAITING_APPROVAL -> SENDING -> (SENT | FAILED). SENDING is a lock, not a
   * resting state, and the scanner has no code path to release it.
   *
   * Unattended sends (when `autoSendEligible` is true) MUST be triggered by a
   * separate mechanism: either an EventBridge rule polling for eligible requests,
   * a webhook from the settings UI when the toggle is flipped, or a manual API
   * call to the send handler. The scanner only ever transitions to
   * AWAITING_APPROVAL — the record sits there until something invokes the send
   * path.
   *
   * This keeps the scanner a pure reconciler and avoids stranding records in a
   * lock forever if the downstream send mechanism is not wired up yet.
   */
  const nextState: FoiaAutomationState = 'AWAITING_APPROVAL';

  const moved = await transitionFoiaAutomationState({
    orgId,
    projectId,
    oppId,
    from: 'SCHEDULED',
    to: nextState,
    patch: {
      becameDueAt: nowIso(),
      blockedReason: null,
      foiaRequestId: outcome.request.foiaId,
      resolvedRecipientEmail: outcome.request.agencyFOIAEmail,
      resolvedRecipientAddress: outcome.request.agencyFOIAAddress,
      // Widened to `string` on FOIARequestItemSchema to avoid a circular import;
      // the value originates from the resolver, which only ever sets a real
      // FoiaRecipientSource. Parsed back to the enum here.
      recipientSource: FoiaRecipientSourceSchema.safeParse(outcome.request.recipientSource).data,
      artifacts: outcome.artifacts,
      // Store the eligibility decision so the downstream sender knows whether it
      // needs a human click or can proceed unattended.
      autoSendEligible: outcome.autoSendEligible,
    },
  });

  // A null transition means a concurrent run already advanced this record. The
  // artifacts it wrote are keyed by that run's foiaId, so they are simply
  // unreferenced — harmless, and cheaper than trying to unwind them.
  if (!moved) return 'SKIPPED';

  await syncOpportunityFoiaMarker(orgId, projectId, oppId, nextState);

  return 'PREPARED';
};

const reconcileOrg = async (args: {
  orgId: string;
  dryRun: boolean;
}): Promise<OrgScanResult> => {
  const { orgId, dryRun } = args;

  const result = emptyResult(orgId);

  const settings = await getFoiaSettings(orgId);

  if (!settings.automationEnabled) {
    console.log(`[foia-scan] org ${orgId}: automation disabled, skipping`);
    return result;
  }

  const { items: opportunities } = await listOpportunitiesByOrg({ orgId });

  for (const opportunity of opportunities) {
    const { projectId, oppId } = opportunity;
    if (!projectId || !oppId) {
      result.skipped += 1;
      continue;
    }

    // One opportunity must never abort the pass — a bad record would otherwise
    // starve every opportunity after it, indefinitely.
    try {
      const existing = await getFoiaAutomation(orgId, projectId, oppId);

      // Leave anything the reconciler does not own: a record mid-approval,
      // already sent, failed, or manually completed is not ours to rewrite.
      if (existing && !RECONCILABLE_STATES.includes(existing.state)) {
        result.skipped += 1;
        continue;
      }

      const intent = await decideIntent({
        opportunity,
        settings,
        delayDaysOverride: existing?.delayDaysOverride ?? null,
      });

      // Never create a record just to say "nothing to do" — that would put a
      // row under every opportunity in the table for no benefit.
      if (!existing && intent.state === 'NOT_APPLICABLE') {
        result.skipped += 1;
        continue;
      }

      /**
       * Idempotency gates the WRITE, not the pass.
       *
       * This used to `continue` here, which silently killed the entire Level 2
       * timer. `decideIntent` is a pure recompute from inputs that do not change
       * between nights, and `computeFoiaScheduledSendAt` is deterministic, so the
       * recomputed intent is byte-identical to the stored record on every pass
       * after the first. `matchesIntent` was therefore permanently true from the
       * moment the record was written, and the due-check below — the thing that
       * actually composes and sends the request — was reachable only on the one
       * pass that changed the record. A request scheduled 90 days out was never
       * prepared, on any night, ever.
       *
       * The reconciler's own comments assumed the opposite ("a missed night
       * self-corrects within 24 hours"); it self-corrected nothing, precisely
       * because nothing changed. The existing tests missed it because they stub
       * `getFoiaAutomation` to null, exercising only the first pass.
       */
      const alreadyMatches = matchesIntent(existing, intent);
      if (alreadyMatches) {
        result.unchanged += 1;
      }

      if (!alreadyMatches && !dryRun) {
        if (existing) {
          await setFoiaAutomationState({
            orgId,
            projectId,
            oppId,
            state: intent.state,
            patch: {
              scheduledSendAt: intent.scheduledSendAt,
              ...(intent.suppressedReason
                ? { suppressedReason: intent.suppressedReason }
                : {}),
            },
          });
        } else {
          await upsertFoiaAutomation({
            orgId,
            projectId,
            oppId,
            state: intent.state,
            scheduledSendAt: intent.scheduledSendAt,
            triggeredBy: 'TIMER',
          });
        }

        await syncOpportunityFoiaMarker(orgId, projectId, oppId, intent.state);
      }

      // Only count a state transition we actually made; an unchanged record was
      // already tallied above and must not be double-counted.
      if (!alreadyMatches) {
        if (intent.state === 'SCHEDULED') result.scheduled += 1;
        else if (intent.state === 'SUPPRESSED') result.suppressed += 1;
        else result.notApplicable += 1;
      }

      // A scheduled request whose time has arrived gets composed now. This is a
      // separate transition from scheduling on purpose: preparation writes a real
      // FOIA record and S3 artifacts, so it must be reached through a conditional
      // state change that cannot fire twice.
      if (intent.state === 'SCHEDULED' && isDue(intent.scheduledSendAt)) {
        const outcome = await prepareDueAutomation({
          orgId,
          projectId,
          oppId,
          opportunity,
          settings,
          dryRun,
        });

        if (outcome === 'PREPARED') result.prepared += 1;
        else if (outcome === 'BLOCKED') result.blocked += 1;
      }
    } catch (err) {
      result.errors += 1;
      console.error(
        `[foia-scan] org ${orgId} opp ${oppId}: reconcile failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return result;
};

export const baseHandler = async (event: ScanEvent) => {
  const dryRun = Boolean(event?.detail?.dryRun);
  const onlyOrgId = event?.detail?.orgId;
  const ranAt = nowIso();

  // The single-org escape hatch mirrors run-saved-search.ts, so this Lambda can
  // be invoked manually against one tenant without touching the others.
  const orgIds = onlyOrgId ? [onlyOrgId] : await listAllOrgIds();

  console.log(`[foia-scan] starting${dryRun ? ' (dry run)' : ''} for ${orgIds.length} org(s)`);

  const results: OrgScanResult[] = [];

  // Sequential per org: this runs nightly with no latency requirement, and
  // serial execution keeps DynamoDB consumption flat and the logs readable.
  for (const orgId of orgIds) {
    try {
      results.push(await reconcileOrg({ orgId, dryRun }));
    } catch (err) {
      console.error(
        `[foia-scan] org ${orgId}: scan failed:`,
        err instanceof Error ? err.message : String(err),
      );
      results.push({ ...emptyResult(orgId), errors: 1 });
    }
  }

  const totals = results.reduce(
    (acc, r) => ({
      scheduled: acc.scheduled + r.scheduled,
      notApplicable: acc.notApplicable + r.notApplicable,
      suppressed: acc.suppressed + r.suppressed,
      unchanged: acc.unchanged + r.unchanged,
      skipped: acc.skipped + r.skipped,
      errors: acc.errors + r.errors,
      prepared: acc.prepared + r.prepared,
      blocked: acc.blocked + r.blocked,
    }),
    {
      scheduled: 0,
      notApplicable: 0,
      suppressed: 0,
      unchanged: 0,
      skipped: 0,
      errors: 0,
      prepared: 0,
      blocked: 0,
    },
  );

  console.log(`[foia-scan] finished:`, JSON.stringify(totals));

  return {
    ok: true,
    dryRun,
    ranAt,
    orgCount: orgIds.length,
    totals,
    results: results.filter(
      (r) => r.scheduled || r.suppressed || r.notApplicable || r.errors || r.prepared || r.blocked,
    ),
  };
};

export const handler = withSentryLambda(middy(baseHandler));
