import middy from '@middy/core';

import {
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
  upsertFoiaAutomation,
} from '@/helpers/foia-automation';

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
}

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

const reconcileOrg = async (args: {
  orgId: string;
  dryRun: boolean;
}): Promise<OrgScanResult> => {
  const { orgId, dryRun } = args;

  const result: OrgScanResult = {
    orgId,
    scheduled: 0,
    notApplicable: 0,
    suppressed: 0,
    unchanged: 0,
    skipped: 0,
    errors: 0,
  };

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

      if (matchesIntent(existing, intent)) {
        result.unchanged += 1;
        continue;
      }

      if (!dryRun) {
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

      if (intent.state === 'SCHEDULED') result.scheduled += 1;
      else if (intent.state === 'SUPPRESSED') result.suppressed += 1;
      else result.notApplicable += 1;
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
      results.push({
        orgId,
        scheduled: 0,
        notApplicable: 0,
        suppressed: 0,
        unchanged: 0,
        skipped: 0,
        errors: 1,
      });
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
    }),
    { scheduled: 0, notApplicable: 0, suppressed: 0, unchanged: 0, skipped: 0, errors: 0 },
  );

  console.log(`[foia-scan] finished:`, JSON.stringify(totals));

  return {
    ok: true,
    dryRun,
    ranAt,
    orgCount: orgIds.length,
    totals,
    results: results.filter(
      (r) => r.scheduled || r.suppressed || r.notApplicable || r.errors,
    ),
  };
};

export const handler = withSentryLambda(middy(baseHandler));
