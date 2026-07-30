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
import type {
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

/**
 * A single raw GraphQL query per page, with every nested field inlined. The
 * SDK's lazy relations (issue.state / .assignee / .creator / .labels()) would
 * otherwise cost one round-trip per issue per relation — ~4×250 = 1000 requests
 * — which Linear rate-limits/resets. This is one request per 250-issue page.
 */
const PROJECT_ISSUES_QUERY = `
  query RfpProjectIssues($name: String!, $after: String) {
    projects(filter: { name: { eq: $name } }, first: 1) {
      nodes {
        id
        issues(first: 250, after: $after) {
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
}

/**
 * Merge a resolved Linear row into an existing record (or seed a fresh one when
 * none exists). This is an INCREMENTAL merge, not a full overwrite:
 *
 *  - Current-state fields (status, approvalStatus, pipelineStage, title, etc.)
 *    are authoritative from Linear.
 *  - statusHistory / approvalHistory are PRESERVED. A new transition entry is
 *    APPENDED only when the resolved value actually differs from the existing
 *    current value (dedupe — an unchanged re-sync appends nothing), with the
 *    best available real timestamp and `from` = the previous value.
 *  - createdAt / createdBy are preserved from the existing record.
 *  - For a brand-new record (no existing item) a single honest seed entry
 *    (from: null → current) is written.
 */
const buildRecord = (row: LinearRow, stage: RfpPipelineStage, existing: ExistingRecord | null) => {
  const approvalStatus = STAGE_TO_APPROVAL[stage];
  const status = STAGE_TO_STATUS[stage];
  const oppId = oppIdFor(row.id);
  const syncedAt = nowIso();
  const changedAt = transitionTimestamp(row, stage);

  // ── statusHistory: preserve + append-on-change ──────────────────────────────
  const existingStatusHistory = existing?.statusHistory ?? [];
  const prevStatus = existing?.status ?? null;
  const statusHistory: OpportunityStatusTransition[] =
    existing === null
      ? [
          {
            from: null,
            to: status,
            changedAt,
            changedBy: 'system',
            reason: `Synced from Linear ${row.id}`,
            source: 'SYSTEM',
          },
        ]
      : prevStatus === status
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

  // ── approvalHistory: preserve + append-on-change ────────────────────────────
  const existingApprovalHistory = existing?.approvalHistory ?? [];
  const prevApproval = existing?.approvalStatus ?? null;
  const approvalReason = `Synced from Linear ${row.id} (${row.labels.join(', ') || 'no label'})`;
  const approvalHistory: OpportunityApprovalTransition[] =
    existing === null
      ? [
          {
            from: null,
            to: approvalStatus,
            changedAt,
            changedBy: 'system',
            reason: approvalReason,
            gate: gateFor(approvalStatus),
          },
        ]
      : prevApproval === approvalStatus
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
    records.push(buildRecord(row, stage, existingBySk.get(sk) ?? null));
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
