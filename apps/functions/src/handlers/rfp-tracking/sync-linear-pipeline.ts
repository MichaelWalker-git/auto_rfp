import { LinearClient } from '@linear/sdk';
import {
  resolveRfpStage,
  isStageAlwaysShown,
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
import { docClient, queryAllBySkPrefix, deleteItem, getItem, putItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { nowIso } from '@/helpers/date';
import { PutCommand } from '@aws-sdk/lib-dynamodb';

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
const INTAKE_STALE_DAYS = Number(requireEnv('RFP_SYNC_INTAKE_STALE_DAYS', '21'));

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

const buildRecord = (row: LinearRow, stage: RfpPipelineStage) => {
  const approvalStatus = STAGE_TO_APPROVAL[stage];
  const status = STAGE_TO_STATUS[stage];
  const oppId = oppIdFor(row.id);
  const syncedAt = nowIso();

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
    statusHistory: [
      {
        from: null,
        to: status,
        changedAt: row.updatedAt,
        changedBy: 'system',
        reason: `Synced from Linear ${row.id}`,
        source: 'SYSTEM' as const,
      },
    ],
    approvalStatus,
    approvalHistory: [
      {
        from: null,
        to: approvalStatus,
        changedAt: row.updatedAt,
        changedBy: 'system',
        reason: `Synced from Linear ${row.id} (${row.labels.join(', ') || 'no label'})`,
        gate: gateFor(approvalStatus),
      },
    ],
    pipelineStage: stage,
    completedAt: row.completedAt,
    baseAndAllOptionsValue: null,
    assigneeName: row.assignee ?? undefined,
    createdByName: row.creator ?? 'Linear sync',
    sourceUrl: row.url,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: 'system',
    updatedBy: 'system',
    updatedByName: 'Linear sync',
    syncedAt,
  };
};

interface SyncResult {
  fetched: number;
  written: number;
  pruned: number;
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
    records.push(buildRecord(row, stage));
  }

  const byStage = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.pipelineStage] = (acc[r.pipelineStage] ?? 0) + 1;
    return acc;
  }, {});

  // Upsert every current record.
  for (const record of records) {
    await docClient.send(new PutCommand({ TableName: requireEnv('DB_TABLE_NAME'), Item: record }));
  }

  // Prune previously-synced records that are no longer shown. Only touch records
  // this job owns (SK prefix `${orgId}#${projectId}#linear-`).
  const keep = new Set(records.map((r) => r[SK_NAME]));
  const skPrefix = `${buildOpportunitySk(ORG_ID, PROJECT_ID, 'linear-')}`;
  const existing = await queryAllBySkPrefix<{ [k: string]: string }>(OPPORTUNITY_PK, skPrefix);

  let pruned = 0;
  for (const item of existing) {
    const sk = item[SK_NAME];
    if (sk && !keep.has(sk)) {
      await deleteItem(OPPORTUNITY_PK, sk);
      pruned += 1;
    }
  }

  return {
    fetched: rows.length,
    written: records.length,
    pruned,
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
