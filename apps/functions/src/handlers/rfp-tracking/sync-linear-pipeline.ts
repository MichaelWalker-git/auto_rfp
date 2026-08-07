import { LinearClient } from '@linear/sdk';
import {
  resolveRfpStage,
  isStageAlwaysShown,
  RFP_TERMINAL_STAGES,
  RFP_TERMINAL_WINDOW_DAYS,
  type RfpPipelineStage,
  type OpportunityApprovalStatus,
  type OpportunityStatus,
} from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { getApiKey } from '@/helpers/api-key-storage';
import { LINEAR_SECRET_PREFIX } from '@/constants/linear';
import { OPPORTUNITY_PK } from '@/constants/opportunity';
import { PROJECT_PK } from '@/constants/organization';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { buildOpportunitySk } from '@/helpers/opportunity';
import { queryAllBySkPrefix, deleteItem, getItem, putItem, putFullItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { ensureAceTechnicalValidation } from '@/helpers/ace-stage';
import { startAceSubmission } from '@/helpers/ace-submission';
import type {
  AceStage,
  AceStageTransition,
  OpportunityApprovalTransition,
  OpportunityStatusTransition,
} from '@auto-rfp/core';

/**
 * Scheduled sync: mirror the Linear "Government Contracting" board into the
 * RFP-tracking pipeline as Opportunity records, every 15 minutes.
 *
 * The RFP-tracking board (get-rfp-pipeline → listOpportunitiesByOrg) renders
 * Opportunity records from DynamoDB (PK=OPPORTUNITY, SK begins_with `${orgId}#`).
 * There is no live Linear integration in the app, so this Lambda bridges the
 * gap: it pulls the Government Contracting board from Linear and upserts one
 * Opportunity per issue, then prunes records that are no longer shown.
 *
 * Board stage is derived from the Linear workflow STATUS + gate labels
 * (first-match-wins), via the shared `resolveRfpStage` in @auto-rfp/core — the
 * same model the Slack RFP digest uses, so the board and the digest agree.
 *
 * Window: open + standing stages are kept regardless of age (they are the live
 * inventory); terminal stages (submitted/awarded/lost/notApproved) are kept
 * only if they closed within RFP_TERMINAL_WINDOW_DAYS, because lifetime terminal
 * totals are dominated by years of closed work.
 *
 * Env (set in the CDK stack):
 *   RFP_SYNC_ORG_ID        — target AutoRFP org id
 *   RFP_SYNC_PROJECT_ID    — synthetic project id for these records
 *   RFP_SYNC_LINEAR_ORG_ID — org id whose Secrets Manager entry holds the key
 *   RFP_SYNC_PROJECT_NAME  — Linear project name to pull (default below)
 */

/**
 * One Linear issue-history event, reduced to the fields the timeline
 * reconstruction needs: when it happened, the workflow-state delta, and the
 * label deltas. `addedLabels`/`removedLabels` are label NAMES (Linear returns
 * `IssueLabel` objects; we keep `.name`).
 */
interface LinearHistoryEvent {
  createdAt: string;
  fromStateName: string | null;
  toStateName: string | null;
  addedLabels: string[];
  removedLabels: string[];
}

interface LinearRow {
  id: string;
  title: string;
  linearStatus: string;
  labels: string[];
  dueDate: string | null;
  assignee: string | null;
  creator: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  url: string;
  /** Full issue-history events, sorted ascending by `createdAt`. */
  history: LinearHistoryEvent[];
}

const ORG_ID = requireEnv('RFP_SYNC_ORG_ID');
const PROJECT_ID = requireEnv('RFP_SYNC_PROJECT_ID');
const LINEAR_ORG_ID = requireEnv('RFP_SYNC_LINEAR_ORG_ID');
const PROJECT_NAME = requireEnv('RFP_SYNC_PROJECT_NAME', 'Government Contracting');
/**
 * Intake staleness cutoff. An issue still in the intake stage
 * (execSummaryToReview) that is past its due date, or has gone untouched for
 * this many days, is treated as dead and reclassified to `expired` so it drops
 * off the live review queue. Default 21 days; set 0 to disable.
 */
const INTAKE_STALE_DAYS_PARSED = Number(requireEnv('RFP_SYNC_INTAKE_STALE_DAYS', '21'));
const INTAKE_STALE_DAYS = Number.isFinite(INTAKE_STALE_DAYS_PARSED) ? INTAKE_STALE_DAYS_PARSED : 21;

/**
 * Prune safety: skip the destructive prune (and log loudly) if the number of
 * records that WOULD be deleted exceeds this fraction of the existing inventory.
 * A drop this large almost always means a partial Linear fetch (a paged request
 * that errored halfway, or a transient empty page) rather than that many genuine
 * board deletions in a single 15-minute window.
 */
const PRUNE_MAX_DROP_FRACTION = 0.5;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The two-gate approval axis (drives the Approval Queue tab) derived from the
 * board stage, so the queue keeps working off the same source of truth.
 */
const STAGE_TO_APPROVAL: Record<RfpPipelineStage, OpportunityApprovalStatus> = {
  found: 'INITIAL_APPROVAL',
  execSummaryToReview: 'INITIAL_APPROVAL',
  firstApproved: 'I_APPROVED',
  inProgress: 'I_APPROVED',
  preSubmissionReview: 'PRE_SUB_APPROVAL',
  secondApproved: 'II_APPROVED',
  submitted: 'SUBMITTED',
  awarded: 'SUBMITTED',
  lost: 'SUBMITTED',
  notApproved: 'NOT_APPROVED',
  expired: 'NOT_APPROVED',
};

/** The unified pipeline/outcome status (drives brief scoring, WON/LOST, etc.). */
const STAGE_TO_STATUS: Record<RfpPipelineStage, OpportunityStatus> = {
  found: 'IDENTIFIED',
  execSummaryToReview: 'QUALIFYING',
  firstApproved: 'PURSUING',
  inProgress: 'PURSUING',
  preSubmissionReview: 'PURSUING',
  secondApproved: 'PURSUING',
  submitted: 'SUBMITTED',
  awarded: 'WON',
  lost: 'LOST',
  notApproved: 'NO_BID',
  expired: 'NO_BID',
};

const gateFor = (approval: OpportunityApprovalStatus): 'INITIAL' | 'FINAL' | 'STAGE' => {
  if (approval === 'I_APPROVED' || approval === 'NOT_APPROVED') return 'INITIAL';
  if (approval === 'II_APPROVED') return 'FINAL';
  return 'STAGE';
};

const toDeadlineIso = (d: string | null): string | null => (d ? `${d}T23:59:59.000Z` : null);

/** Stable, idempotent oppId derived from the Linear issue identifier. */
const oppIdFor = (linearId: string) => `linear-${linearId.toLowerCase()}`;

/**
 * Stages that represent a genuinely closed/terminal outcome. Only these carry a
 * `completedAt` — populating it for open/standing stages poisons `submittedAtIso`
 * and the outcome-breakdown window (a still-open item would look "closed").
 */
const TERMINAL_STAGES = new Set<RfpPipelineStage>(RFP_TERMINAL_STAGES);
const isTerminalStage = (stage: RfpPipelineStage): boolean => TERMINAL_STAGES.has(stage);

/**
 * The best real timestamp for a transition INTO `stage`. For terminal stages we
 * prefer Linear's `completedAt` (when the issue actually closed); otherwise the
 * issue's last-edit time is the closest available signal for the change.
 */
const transitionTimestamp = (row: LinearRow, stage: RfpPipelineStage): string =>
  (isTerminalStage(stage) && row.completedAt ? row.completedAt : row.updatedAt);

// ─── History reconstruction ───────────────────────────────────────────────────

/** One resolved board stage the issue occupied, with the REAL time it entered it. */
interface StageEntry {
  stage: RfpPipelineStage;
  at: string;
}

/**
 * Replay a Linear issue's audited history (workflow-state changes + label
 * add/remove events, each with a real `createdAt`) into the ordered list of
 * board stages it actually passed through. This is the input the metrics tab
 * was missing: cycle-time, aging, and the win-rate window all need to know WHEN
 * an issue reached each gate, not just where it sits now.
 *
 * How it works:
 *   - Reconstruct the (status, labelSet) the issue had over time by replaying
 *     the history forward from creation (labels start empty; every add/remove is
 *     applied in `createdAt` order), running the SAME `resolveRfpStage` used for
 *     current state at each step so historical and live resolution can't diverge.
 *   - Emit a StageEntry whenever the resolved stage changes.
 *   - The authoritative CURRENT stage always terminates the timeline: replay can
 *     drift from the live state when history is truncated (> HISTORY_EVENTS_PER_ISSUE
 *     events) or a label predates the fetched window, so we trust the caller's
 *     resolved `currentStage`, stamped with its best real timestamp.
 *
 * With no history events at all, the timeline collapses to a single current-stage
 * entry stamped via `transitionTimestamp` — identical to the pre-history seed, so
 * behaviour degrades gracefully.
 */
const reconstructStageTimeline = (row: LinearRow, currentStage: RfpPipelineStage): StageEntry[] => {
  const events = [...row.history].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const timeline: StageEntry[] = [];

  const pushIfChanged = (status: string, labels: Set<string>, at: string): void => {
    const stage = resolveRfpStage({ identifier: row.id, status, labels: [...labels] });
    if (!stage) return;
    const last = timeline[timeline.length - 1];
    if (last && last.stage === stage) return;
    timeline.push({ stage, at });
  };

  if (events.length > 0) {
    // Initial workflow status = the state BEFORE the first recorded status
    // change; if none is recorded the issue has sat in its current status since
    // creation. Labels are rebuilt forward from an empty set at creation.
    let status = row.linearStatus;
    for (const e of events) {
      if (e.fromStateName) {
        status = e.fromStateName;
        break;
      }
    }
    const labels = new Set<string>();

    // Creation-time snapshot captures the intake stage (INITIAL_APPROVAL) so the
    // first cycle-time gap (found → first approval) is derivable.
    pushIfChanged(status, labels, row.createdAt);

    for (const e of events) {
      if (e.toStateName) status = e.toStateName;
      for (const l of e.addedLabels) labels.add(l);
      for (const l of e.removedLabels) labels.delete(l);
      pushIfChanged(status, labels, e.createdAt);
    }
  }

  const last = timeline[timeline.length - 1];
  if (!last || last.stage !== currentStage) {
    timeline.push({ stage: currentStage, at: transitionTimestamp(row, currentStage) });
  }

  return timeline;
};

/**
 * Collapse a stage timeline into an approvalHistory. Consecutive stages that map
 * to the SAME approval milestone (e.g. firstApproved → inProgress are both
 * I_APPROVED) collapse to one entry, so the history is one entry per approval
 * gate actually crossed, with the real `changedAt` of the first stage in that run.
 */
const timelineToApprovalHistory = (
  timeline: StageEntry[],
  row: LinearRow,
): OpportunityApprovalTransition[] => {
  const out: OpportunityApprovalTransition[] = [];
  let prev: OpportunityApprovalStatus | null = null;
  for (const { stage, at } of timeline) {
    const to = STAGE_TO_APPROVAL[stage];
    if (out.length > 0 && to === prev) continue;
    out.push({
      from: prev,
      to,
      changedAt: at,
      changedBy: 'system',
      reason: `Reconstructed from Linear ${row.id} history`,
      gate: gateFor(to),
    });
    prev = to;
  }
  return out;
};

/** As `timelineToApprovalHistory`, but for the unified status axis. */
const timelineToStatusHistory = (
  timeline: StageEntry[],
  row: LinearRow,
): OpportunityStatusTransition[] => {
  const out: OpportunityStatusTransition[] = [];
  let prev: OpportunityStatus | null = null;
  for (const { stage, at } of timeline) {
    const to = STAGE_TO_STATUS[stage];
    if (out.length > 0 && to === prev) continue;
    out.push({
      from: prev,
      to,
      changedAt: at,
      changedBy: 'system',
      reason: `Reconstructed from Linear ${row.id} history`,
      source: 'SYSTEM',
    });
    prev = to;
  }
  return out;
};

/**
 * Is any history entry authored by something OTHER than this sync? The sync
 * stamps its own entries with `changedBy: 'system'`; dashboard gate approvals
 * (opportunity-approval.ts) and brief scoring stamp a real user id or their own
 * author. When present, we must NOT rebuild from Linear — doing so would flatten
 * the "who approved this / why" attribution to `system`. Such records keep the
 * incremental append-on-change merge instead (the safe path).
 */
const hasHumanAuthoredHistory = (existing: ExistingRecord | null): boolean => {
  if (!existing) return false;
  const approval = existing.approvalHistory ?? [];
  const status = existing.statusHistory ?? [];
  return approval.some((e) => e.changedBy !== 'system') || status.some((e) => e.changedBy !== 'system');
};

/**
 * How many issue-history events to pull per issue. Linear enforces a per-query
 * complexity budget (max 10000), and a nested connection multiplies cost:
 * `issues(first: N) × history(first: M)` dominates the query. We keep
 * `ISSUES_PER_PAGE × HISTORY_EVENTS_PER_ISSUE` well under that budget
 * (50 × 25 = 1250 node-products ≈ 7k complexity with the other nested fields).
 *
 * A two-gate RFP flow produces well under 25 status/label transitions, so this
 * covers the full audit trail for the Government Contracting board. If an issue
 * ever exceeds it we still get its most recent 25 events and the reconstruction
 * degrades gracefully to the current-state fallback the sync used before history
 * was available. The board holds ~43 issues, so a 50-issue page also fetches
 * everything in a single request (pagination still kicks in above 50).
 */
const HISTORY_EVENTS_PER_ISSUE = 25;
const ISSUES_PER_PAGE = 50;

/**
 * A single raw GraphQL query per page, with every nested field inlined. The
 * SDK's lazy relations (issue.state / .assignee / .creator / .labels()) would
 * otherwise cost one round-trip per issue per relation — ~4×N = hundreds of
 * requests — which Linear rate-limits/resets. This is one request per page of
 * ISSUES_PER_PAGE issues.
 *
 * `history` is fetched inline here for the same reason: it is the audited,
 * per-transition log (workflow-state changes + label add/remove events, each
 * with a real `createdAt`) that lets us reconstruct WHEN an issue passed each
 * approval gate. Without it we can only observe the current state and guess at
 * timings — which starves cycle-time, aging, and the win-rate window. Ordered
 * ascending so the reconstruction can replay it forward.
 */
const PROJECT_ISSUES_QUERY = `
  query RfpProjectIssues($name: String!, $after: String) {
    projects(filter: { name: { eq: $name } }, first: 1) {
      nodes {
        id
        issues(first: ${ISSUES_PER_PAGE}, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            identifier
            title
            url
            dueDate
            createdAt
            updatedAt
            startedAt
            completedAt
            state { name }
            assignee { name }
            creator { name }
            labels { nodes { name } }
            history(first: ${HISTORY_EVENTS_PER_ISSUE}) {
              nodes {
                createdAt
                fromState { name }
                toState { name }
                addedLabels { name }
                removedLabels { name }
              }
            }
          }
        }
      }
    }
  }
`;

interface ProjectIssuesResponse {
  projects: {
    nodes: Array<{
      id: string;
      issues: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          identifier: string;
          title: string;
          url: string;
          dueDate: string | null;
          createdAt: string;
          updatedAt: string;
          startedAt: string | null;
          completedAt: string | null;
          state: { name: string } | null;
          assignee: { name: string } | null;
          creator: { name: string } | null;
          labels: { nodes: Array<{ name: string }> };
          history: {
            nodes: Array<{
              createdAt: string;
              fromState: { name: string } | null;
              toState: { name: string } | null;
              addedLabels: Array<{ name: string }> | null;
              removedLabels: Array<{ name: string }> | null;
            }>;
          };
        }>;
      };
    }>;
  };
}

/**
 * Pull every issue in the Linear project (no age filter — the window is applied
 * per-stage after resolution). Pages through the raw GraphQL connection.
 */
const fetchLinearRows = async (client: LinearClient): Promise<LinearRow[]> => {
  const rows: LinearRow[] = [];
  let after: string | null = null;
  let sawProject = false;

  do {
    const response: { data?: ProjectIssuesResponse } = await client.client.rawRequest(
      PROJECT_ISSUES_QUERY,
      { name: PROJECT_NAME, after },
    );

    const project = response.data?.projects.nodes[0];
    if (!project) {
      throw new Error(`Linear project not found: ${PROJECT_NAME}`);
    }
    sawProject = true;

    const page = project.issues;
    for (const node of page.nodes) {
      rows.push({
        id: node.identifier,
        title: node.title,
        linearStatus: node.state?.name ?? '',
        labels: node.labels.nodes.map((l) => l.name),
        dueDate: node.dueDate ?? null,
        assignee: node.assignee?.name ?? null,
        creator: node.creator?.name ?? null,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        startedAt: node.startedAt ?? null,
        completedAt: node.completedAt ?? null,
        url: node.url,
        history: node.history.nodes.map((h) => ({
          createdAt: h.createdAt,
          fromStateName: h.fromState?.name ?? null,
          toStateName: h.toState?.name ?? null,
          addedLabels: (h.addedLabels ?? []).map((l) => l.name),
          removedLabels: (h.removedLabels ?? []).map((l) => l.name),
        })),
      });
    }

    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  if (!sawProject) throw new Error(`Linear project not found: ${PROJECT_NAME}`);
  return rows;
};

/**
 * Decide whether a resolved issue is currently shown on the board. Open and
 * standing stages are always shown; terminal stages only if they closed within
 * the terminal window.
 */
const isWithinWindow = (row: LinearRow, stage: RfpPipelineStage, cutoffMs: number): boolean => {
  if (isStageAlwaysShown(stage)) return true;
  const closedIso = row.completedAt ?? row.updatedAt;
  const closed = Date.parse(closedIso);
  return !Number.isNaN(closed) && closed >= cutoffMs;
};

/**
 * Intake staleness: an issue still in the intake stage (execSummaryToReview) is
 * considered dead — and reclassified to `expired` — if its due date has passed
 * or it has gone untouched for INTAKE_STALE_DAYS. This keeps abandoned sourced
 * items from inflating the review queue. Disabled when INTAKE_STALE_DAYS <= 0.
 */
const isStaleIntake = (row: LinearRow, nowMs: number): boolean => {
  const due = row.dueDate ? Date.parse(`${row.dueDate}T23:59:59.000Z`) : NaN;
  if (!Number.isNaN(due) && due < nowMs) return true;

  if (INTAKE_STALE_DAYS <= 0) return false;
  const touched = Date.parse(row.updatedAt);
  return !Number.isNaN(touched) && touched < nowMs - INTAKE_STALE_DAYS * DAY_MS;
};

/**
 * The subset of an existing DynamoDB opportunity record this sync reads when
 * merging. Only the fields we preserve or diff against are typed; everything
 * else on the stored record is irrelevant to the merge.
 */
interface ExistingRecord {
  createdAt?: string;
  createdBy?: string;
  status?: OpportunityStatus;
  approvalStatus?: OpportunityApprovalStatus;
  statusHistory?: OpportunityStatusTransition[];
  approvalHistory?: OpportunityApprovalTransition[];
  // ACE / Partner Central axis — driven outside this sync (submitted-trigger
  // and the board dropdown). buildRecord does a FULL overwrite via putFullItem,
  // so these must be carried forward or every 15-min run would wipe them.
  aceStage?: AceStage;
  aceStageHistory?: AceStageTransition[];
  apnOpportunityId?: string | null;
  apnSyncError?: string | null;
}

/**
 * Merge a resolved Linear row into an existing record (or seed a fresh one when
 * none exists). This is an INCREMENTAL merge, not a full overwrite:
 *
 *  - Current-state fields (status, approvalStatus, pipelineStage, title, etc.)
 *    are authoritative from Linear.
 *  - History handling depends on who authored the existing record:
 *      • Human-authored (a dashboard gate approval / brief scoring wrote an entry
 *        whose `changedBy` is a real user, not 'system') → PRESERVE + append-on-
 *        change, exactly as before. Rebuilding from Linear would flatten the
 *        "who approved this / why" attribution to 'system', so we never do it here.
 *      • System-only or brand-new → RECONSTRUCT the full, correctly-dated history
 *        from Linear's audited issue history (see reconstructStageTimeline). This
 *        backfills the real per-gate timestamps the metrics tab needs; it runs on
 *        every sync but is deterministic/idempotent, so it's a no-op once built.
 *  - createdAt / createdBy are preserved from the existing record.
 */
const buildRecord = (row: LinearRow, stage: RfpPipelineStage, existing: ExistingRecord | null) => {
  const approvalStatus = STAGE_TO_APPROVAL[stage];
  const status = STAGE_TO_STATUS[stage];
  const oppId = oppIdFor(row.id);
  const syncedAt = nowIso();
  const changedAt = transitionTimestamp(row, stage);

  let statusHistory: OpportunityStatusTransition[];
  let approvalHistory: OpportunityApprovalTransition[];

  if (hasHumanAuthoredHistory(existing)) {
    // ── Safe path: preserve human attribution, append-on-change ───────────────
    const existingStatusHistory = existing!.statusHistory ?? [];
    const prevStatus = existing!.status ?? null;
    statusHistory =
      prevStatus === status
        ? existingStatusHistory
        : [
            ...existingStatusHistory,
            {
              from: prevStatus,
              to: status,
              changedAt,
              changedBy: 'system',
              reason: `Synced from Linear ${row.id}`,
              source: 'SYSTEM',
            },
          ];

    const existingApprovalHistory = existing!.approvalHistory ?? [];
    const prevApproval = existing!.approvalStatus ?? null;
    const approvalReason = `Synced from Linear ${row.id} (${row.labels.join(', ') || 'no label'})`;
    approvalHistory =
      prevApproval === approvalStatus
        ? existingApprovalHistory
        : [
            ...existingApprovalHistory,
            {
              from: prevApproval,
              to: approvalStatus,
              changedAt,
              changedBy: 'system',
              reason: approvalReason,
              gate: gateFor(approvalStatus),
            },
          ];
  } else {
    // ── Reconstruct the real, dated timeline from Linear's issue history ──────
    const timeline = reconstructStageTimeline(row, stage);
    statusHistory = timelineToStatusHistory(timeline, row);
    approvalHistory = timelineToApprovalHistory(timeline, row);
  }

  return {
    [PK_NAME]: OPPORTUNITY_PK,
    [SK_NAME]: buildOpportunitySk(ORG_ID, PROJECT_ID, oppId),
    orgId: ORG_ID,
    projectId: PROJECT_ID,
    oppId,
    id: oppId,
    source: 'MANUAL_UPLOAD' as const,
    title: row.title,
    type: null,
    postedDateIso: row.createdAt,
    responseDeadlineIso: toDeadlineIso(row.dueDate),
    noticeId: row.id,
    solicitationNumber: null,
    naicsCode: null,
    pscCode: null,
    organizationName: null,
    setAside: null,
    description: null,
    status,
    statusHistory,
    approvalStatus,
    approvalHistory,
    pipelineStage: stage,
    // Only genuinely terminal stages carry completedAt; open/standing stages get
    // null so submittedAtIso and the outcome window don't treat live work as closed.
    completedAt: isTerminalStage(stage) ? row.completedAt : null,
    baseAndAllOptionsValue: null,
    assigneeName: row.assignee ?? undefined,
    createdByName: row.creator ?? 'Linear sync',
    sourceUrl: row.url,
    // Preserve the original creation identity; only seed it for a brand-new record.
    createdAt: existing?.createdAt ?? row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: existing?.createdBy ?? 'system',
    updatedBy: 'system',
    updatedByName: 'Linear sync',
    syncedAt,
    // Carry the ACE / Partner Central axis forward — this sync never sets it in
    // the record literal (the submitted-trigger below writes it separately), but
    // putFullItem is a full overwrite so omitting these would wipe them each run.
    aceStage: existing?.aceStage,
    aceStageHistory: existing?.aceStageHistory,
    apnOpportunityId: existing?.apnOpportunityId ?? undefined,
    apnSyncError: existing?.apnSyncError ?? undefined,
  };
};

interface SyncResult {
  fetched: number;
  written: number;
  pruned: number;
  /** True when the destructive prune was skipped by the zero-resolve safety floor. */
  prunedSkipped: boolean;
  skippedUntracked: number;
  skippedOutOfWindow: number;
  expiredIntake: number;
  /**
   * ACE (Partner Central) opportunities created or advanced to
   * 'Technical Validation' this run because an RFP transitioned into submitted.
   */
  aceAdvanced: number;
  byStage: Record<string, number>;
}

/**
 * Materialize the synthetic project these records live under, so the app's
 * deep links resolve. The sync writes opportunities under a synthetic
 * `${ORG_ID}#${PROJECT_ID}` (gov-contracting) project that no user ever created,
 * so no Project record exists for it. The board's "View full opportunity" link
 * points at `/organizations/${ORG_ID}/projects/${PROJECT_ID}/opportunities/...`,
 * and the global ProjectProvider redirects to the projects list whenever the
 * URL's project id isn't in the org's project list — bouncing the user off the
 * opportunity page. Seeding the Project record fixes that.
 *
 * Idempotent: only writes when the record is missing, so we don't churn
 * updatedAt on every 15-minute run. Deliberately omits `createdBy` so
 * get-projects treats it as a legacy project that is visible to every org
 * member (not gated behind an explicit per-user assignment).
 *
 * Exported for direct unit testing.
 */
export const ensureSyncProject = async (): Promise<void> => {
  const sk = `${ORG_ID}#${PROJECT_ID}`;
  const existing = await getItem(PROJECT_PK, sk);
  if (existing) return;

  await putItem(PROJECT_PK, sk, {
    id: PROJECT_ID,
    orgId: ORG_ID,
    name: PROJECT_NAME,
    description: 'Government contracting RFPs mirrored from Linear. Managed by the RFP-tracking sync.',
  });
};

/**
 * Exported for direct unit testing (per project convention — test the business
 * function, not the Lambda wrapper).
 */
export const syncLinearPipeline = async (): Promise<SyncResult> => {
  await ensureSyncProject();

  const apiKey = await getApiKey(LINEAR_ORG_ID, LINEAR_SECRET_PREFIX);
  if (!apiKey) {
    throw new Error(`Linear API key not found in Secrets Manager for org ${LINEAR_ORG_ID}`);
  }

  const client = new LinearClient({ apiKey });
  const rows = await fetchLinearRows(client);
  const nowMs = Date.now();
  const cutoffMs = nowMs - RFP_TERMINAL_WINDOW_DAYS * DAY_MS;

  // Load the current inventory ONCE, up-front. It serves two purposes: the
  // per-record merge below reads each existing item to preserve its real
  // history/createdAt, and the prune step reconciles against the same snapshot —
  // so we never re-query or clobber user-made gate approvals.
  const skPrefix = `${buildOpportunitySk(ORG_ID, PROJECT_ID, 'linear-')}`;
  const existing = await queryAllBySkPrefix<ExistingRecord & { [k: string]: unknown }>(
    OPPORTUNITY_PK,
    skPrefix,
  );
  const existingBySk = new Map<string, ExistingRecord>();
  for (const item of existing) {
    const sk = item[SK_NAME];
    if (typeof sk === 'string') existingBySk.set(sk, item);
  }

  let skippedUntracked = 0;
  let skippedOutOfWindow = 0;
  let expiredIntake = 0;
  const records: ReturnType<typeof buildRecord>[] = [];
  // oppIds that transitioned INTO the submitted stage this run (were not
  // submitted before, are now). These trigger the ACE 'Technical Validation'
  // auto-create AFTER the upserts land, so getOpportunity finds the record.
  const submittedTransitions: string[] = [];

  for (const row of rows) {
    const stage = resolveRfpStage({ identifier: row.id, status: row.linearStatus, labels: row.labels });
    // Stages not shown on the board are dropped alongside untracked issues:
    // `found` (Todo/Backlog) hasn't entered the review funnel yet, and `expired`
    // is not a board column (stale intake is dropped below, not given a column).
    // `notApproved` IS shown — a gate-1 rejection needs a visible destination.
    if (!stage || stage === 'found' || stage === 'expired') {
      skippedUntracked += 1;
      continue;
    }
    // Drop dead intake (past due / untouched) so it stops inflating the
    // "Exec summary, to be reviewed" column instead of lingering as live work.
    if (stage === 'execSummaryToReview' && isStaleIntake(row, nowMs)) {
      expiredIntake += 1;
      continue;
    }
    if (!isWithinWindow(row, stage, cutoffMs)) {
      skippedOutOfWindow += 1;
      continue;
    }
    const sk = buildOpportunitySk(ORG_ID, PROJECT_ID, oppIdFor(row.id));
    const existingRec = existingBySk.get(sk) ?? null;

    // Transition INTO submitted: the issue resolves to `submitted` this run and
    // was not already at status SUBMITTED (covers a brand-new record that first
    // appears already submitted, and an existing one crossing the line now). An
    // already-submitted item is skipped here, and ensureAceTechnicalValidation
    // guards on aceStage too — so this never re-creates a second ACE opp.
    if (stage === 'submitted' && existingRec?.status !== 'SUBMITTED') {
      submittedTransitions.push(oppIdFor(row.id));
    }

    records.push(buildRecord(row, stage, existingRec));
  }

  const byStage = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.pipelineStage] = (acc[r.pipelineStage] ?? 0) + 1;
    return acc;
  }, {});

  // Upsert every current record via a full overwrite of the merged item (history
  // and createdAt already preserved by buildRecord, so this no longer clobbers).
  for (const record of records) {
    await putFullItem(record);
  }

  // ACE (Partner Central): an RFP marked submitted on the board is the sole
  // trigger for creating an ACE opportunity — advanced straight to
  // 'Technical Validation'. Runs AFTER the upserts so the record exists for
  // getOpportunity. Best-effort and idempotent: never fails the sync run, and
  // an already-'Technical Validation' opp is a no-op (see ensureAceTechnicalValidation).
  let aceAdvanced = 0;
  for (const oppId of submittedTransitions) {
    const outcome = await ensureAceTechnicalValidation({ orgId: ORG_ID, projectId: PROJECT_ID, oppId });
    if (outcome === 'created' || outcome === 'advanced') aceAdvanced += 1;

    // Kick off the async submit→AWS-review→advance bot for the freshly-created
    // Partner Central opportunity. Gated by ACE_SUBMISSION_ENABLED (no-op when
    // off) and idempotent (leaves an already in-flight submission alone). The
    // scheduled poller then walks it to 'Technical Validation'. Best-effort:
    // startAceSubmission never throws, so it can't fail the sync run.
    await startAceSubmission({ orgId: ORG_ID, projectId: PROJECT_ID, oppId });
  }

  // Prune previously-synced records that are no longer shown. Only touch records
  // this job owns (SK prefix `${orgId}#${projectId}#linear-`).
  const keep = new Set(records.map((r) => r[SK_NAME]));
  const toPrune = existing.filter((item) => {
    const sk = item[SK_NAME];
    return typeof sk === 'string' && !keep.has(sk);
  });

  // Safety floor against a degenerate run wiping the whole board. A healthy
  // Linear board is never empty, so a run that resolved ZERO records almost
  // always means an upstream hiccup — a transient empty page, or issues whose
  // `state` came back null (eventual consistency) so every row fell through
  // resolveRfpStage to null. Pruning on such a run would delete every existing
  // record, blanking the dashboard until the next healthy run repopulates it.
  // When there is prior inventory but nothing resolved, skip the prune entirely
  // and let the next run reconcile. (A genuine empty board — no existing
  // records either — needs no prune anyway.)
  if (records.length === 0 && existing.length > 0) {
    console.warn(
      'Linear pipeline sync resolved 0 records while %d exist — skipping prune to avoid wiping the board',
      existing.length,
    );
    return {
      fetched: rows.length,
      written: 0,
      pruned: 0,
      prunedSkipped: true,
      skippedUntracked,
      skippedOutOfWindow,
      expiredIntake,
      aceAdvanced,
      byStage,
    };
  }

  // Proportional guard: even when SOME records resolved, a prune that would drop
  // more than PRUNE_MAX_DROP_FRACTION of the existing inventory almost certainly
  // reflects a partial Linear fetch (a page that errored, or half the board
  // coming back stage-less) rather than that many genuine deletions in one
  // 15-minute window. Skip the prune and let the next healthy run reconcile.
  if (existing.length > 0 && toPrune.length > existing.length * PRUNE_MAX_DROP_FRACTION) {
    console.warn(
      'Linear pipeline sync would prune %d of %d records (> %d%%) — skipping prune; likely a partial fetch, not real deletions',
      toPrune.length,
      existing.length,
      Math.round(PRUNE_MAX_DROP_FRACTION * 100),
    );
    return {
      fetched: rows.length,
      written: records.length,
      pruned: 0,
      prunedSkipped: true,
      skippedUntracked,
      skippedOutOfWindow,
      expiredIntake,
      aceAdvanced,
      byStage,
    };
  }

  let pruned = 0;
  for (const item of toPrune) {
    const sk = item[SK_NAME];
    if (typeof sk === 'string') {
      await deleteItem(OPPORTUNITY_PK, sk);
      pruned += 1;
    }
  }

  return {
    fetched: rows.length,
    written: records.length,
    pruned,
    prunedSkipped: false,
    skippedUntracked,
    skippedOutOfWindow,
    expiredIntake,
    aceAdvanced,
    byStage,
  };
};

const baseHandler = async (): Promise<{ statusCode: number; body: string }> => {
  try {
    const result = await syncLinearPipeline();
    console.log('Linear pipeline sync complete', result);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err: unknown) {
    console.error('Linear pipeline sync failed', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    };
  }
};

export const handler = withSentryLambda(baseHandler);
