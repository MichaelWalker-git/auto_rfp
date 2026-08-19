/**
 * DynamoDB persistence for AI Compliance Review.
 *
 * Three record types (all opportunity-scoped):
 *   - Chat messages   PK COMPLIANCE_REVIEW_CHAT      SK {orgId}#{projectId}#{oppId}#{ts}#{messageId}
 *   - Review runs     PK COMPLIANCE_REVIEW_RUN       SK {orgId}#{projectId}#{oppId}#{startedAt}#{reviewId}
 *   - Decisions       PK COMPLIANCE_FINDING_DECISION SK {orgId}#{projectId}#{oppId}#{fingerprint}
 *
 * Findings are per-run (latest-run authoritative). Decisions persist across runs
 * keyed by fingerprint. `applyDecisionsToFindings` folds decisions into a run's
 * findings: dismissed → suppressed; resolved → suppressed only while the issue
 * stays absent (a re-detected resolved finding becomes active again).
 */
import { v4 as uuidv4 } from 'uuid';
import { TransactWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import {
  createItem,
  getItem,
  putItem,
  queryBySkPrefix,
  deleteAllBySkPrefix,
  batchDeleteItems,
  docClient,
} from '@/helpers/db';
import {
  COMPLIANCE_REVIEW_CHAT_PK,
  COMPLIANCE_REVIEW_RUN_PK,
  COMPLIANCE_FINDING_DECISION_PK,
  RUN_STALE_TIMEOUT_MS,
  RUN_KEEP_COUNT,
  RUN_TTL_DAYS,
} from '@/constants/compliance-review';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { nowIso } from '@/helpers/date';
import { requireEnv } from '@/helpers/env';
import type {
  ComplianceFinding,
  ComplianceReviewMessage,
  ComplianceReviewRun,
  ComplianceReviewRunStatus,
  ComplianceReviewRunTrigger,
  FindingDecision,
  FindingDecisionState,
} from '@auto-rfp/core';

// ─── Item types (DB rows extend the domain shapes) ──────────────────────────

export interface ComplianceReviewMessageItem extends ComplianceReviewMessage {
  orgId: string;
  projectId: string;
}

export interface ComplianceReviewRunItem extends ComplianceReviewRun {
  /** Epoch seconds for DynamoDB auto-expiry (retention backstop). */
  ttl?: number;
}

export interface FindingDecisionItem extends FindingDecision {
  orgId: string;
  projectId: string;
  oppId: string;
}

// ─── SK builders ────────────────────────────────────────────────────────────

const oppPrefix = (orgId: string, projectId: string, oppId: string): string =>
  `${orgId}#${projectId}#${oppId}#`;

export const buildChatMessageSK = (
  orgId: string,
  projectId: string,
  oppId: string,
  timestamp: string,
  messageId: string,
): string => `${oppPrefix(orgId, projectId, oppId)}${timestamp}#${messageId}`;

export const buildRunSK = (
  orgId: string,
  projectId: string,
  oppId: string,
  startedAt: string,
  reviewId: string,
): string => `${oppPrefix(orgId, projectId, oppId)}${startedAt}#${reviewId}`;

export const buildDecisionSK = (
  orgId: string,
  projectId: string,
  oppId: string,
  fingerprint: string,
): string => `${oppPrefix(orgId, projectId, oppId)}${fingerprint}`;

// ─── Chat persistence ───────────────────────────────────────────────────────

export const saveComplianceMessagePair = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  userMessage: string;
  assistantAnswer: string;
  findings: ComplianceFinding[];
  userId?: string;
  /** Set when the assistant turn started a cross-package edit run (unified chat). */
  editRunId?: string;
}): Promise<{ userMsg: ComplianceReviewMessageItem; assistantMsg: ComplianceReviewMessageItem }> => {
  const { orgId, projectId, oppId, userMessage, assistantAnswer, findings, userId, editRunId } = args;
  const tableName = requireEnv('DB_TABLE_NAME');

  const userTimestamp = nowIso();
  const userMsg: ComplianceReviewMessageItem = {
    messageId: uuidv4(),
    orgId,
    projectId,
    oppId,
    role: 'user',
    content: userMessage,
    userId,
    createdAt: userTimestamp,
  };
  const userSK = buildChatMessageSK(orgId, projectId, oppId, userTimestamp, userMsg.messageId);

  const assistantTimestamp = new Date(new Date(userTimestamp).getTime() + 1).toISOString();
  const assistantMsg: ComplianceReviewMessageItem = {
    messageId: uuidv4(),
    orgId,
    projectId,
    oppId,
    role: 'assistant',
    content: assistantAnswer,
    findings,
    ...(editRunId ? { editRunId } : {}),
    userId,
    createdAt: assistantTimestamp,
  };
  const assistantSK = buildChatMessageSK(orgId, projectId, oppId, assistantTimestamp, assistantMsg.messageId);

  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: tableName, Item: { [PK_NAME]: COMPLIANCE_REVIEW_CHAT_PK, [SK_NAME]: userSK, ...userMsg } } },
        { Put: { TableName: tableName, Item: { [PK_NAME]: COMPLIANCE_REVIEW_CHAT_PK, [SK_NAME]: assistantSK, ...assistantMsg } } },
      ],
    }),
  );

  return { userMsg, assistantMsg };
};

export const listComplianceReviewHistory = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<ComplianceReviewMessageItem[]> => {
  const items = await queryBySkPrefix<ComplianceReviewMessageItem>(
    COMPLIANCE_REVIEW_CHAT_PK,
    oppPrefix(orgId, projectId, oppId),
  );
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

export const deleteComplianceReviewHistory = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<{ deleted: number; failed: number }> =>
  deleteAllBySkPrefix(COMPLIANCE_REVIEW_CHAT_PK, oppPrefix(orgId, projectId, oppId));

// ─── Run persistence ────────────────────────────────────────────────────────

/**
 * Create a new review run, guarded so only one run per opportunity can be
 * active at a time. Returns null if an active (non-stale RUNNING) run exists.
 */
export const createReviewRun = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  trigger: ComplianceReviewRunTrigger;
  snapshotVersionIds: Record<string, string>;
}): Promise<ComplianceReviewRunItem | null> => {
  const { orgId, projectId, oppId, trigger, snapshotVersionIds } = args;

  const existingRuns = await listReviewRuns(orgId, projectId, oppId);
  if (existingRuns[0] && isRunActive(existingRuns[0])) return null;

  const startedAt = nowIso();
  const reviewId = uuidv4();
  const item = await createItem<ComplianceReviewRunItem>(
    COMPLIANCE_REVIEW_RUN_PK,
    buildRunSK(orgId, projectId, oppId, startedAt, reviewId),
    {
      reviewId,
      orgId,
      projectId,
      oppId,
      status: 'RUNNING',
      trigger,
      startedAt,
      snapshotVersionIds,
      findings: [],
      ttl: Math.floor(Date.now() / 1000) + RUN_TTL_DAYS * 86400,
    },
  );

  // Prune to the most recent RUN_KEEP_COUNT (the new run is #1). Best-effort —
  // failures here must not block the review. TTL is the backstop.
  const toPrune = existingRuns.slice(RUN_KEEP_COUNT - 1);
  if (toPrune.length) {
    await batchDeleteItems(
      toPrune.map((r) => ({
        pk: COMPLIANCE_REVIEW_RUN_PK,
        sk: buildRunSK(r.orgId, r.projectId, r.oppId, r.startedAt, r.reviewId),
      })),
    ).catch((err) => console.warn('[compliance-review] run prune failed (non-blocking):', (err as Error)?.message));
  }

  return item;
};

/** All runs for an opportunity, newest first. */
export const listReviewRuns = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<ComplianceReviewRunItem[]> => {
  const items = await queryBySkPrefix<ComplianceReviewRunItem>(
    COMPLIANCE_REVIEW_RUN_PK,
    oppPrefix(orgId, projectId, oppId),
  );
  return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};

/** Most recent run for an opportunity (by startedAt), or null. */
export const getLatestReviewRun = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<ComplianceReviewRunItem | null> => {
  const items = await listReviewRuns(orgId, projectId, oppId);
  return items[0] ?? null;
};

/** Delete all runs for an opportunity. Called on opportunity deletion cleanup. */
export const deleteReviewRuns = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<{ deleted: number; failed: number }> =>
  deleteAllBySkPrefix(COMPLIANCE_REVIEW_RUN_PK, oppPrefix(orgId, projectId, oppId));

/** True while a run is RUNNING and hasn't exceeded the crash-recovery timeout. */
export const isRunActive = (run: ComplianceReviewRun): boolean => {
  if (run.status !== 'RUNNING') return false;
  const age = Date.now() - new Date(run.startedAt).getTime();
  return age < RUN_STALE_TIMEOUT_MS;
};

/** True for a RUNNING run that has exceeded the timeout (worker presumed dead). */
export const isRunStale = (run: ComplianceReviewRun): boolean =>
  run.status === 'RUNNING' && Date.now() - new Date(run.startedAt).getTime() >= RUN_STALE_TIMEOUT_MS;

const updateRun = async (
  run: ComplianceReviewRunItem,
  patch: Partial<ComplianceReviewRunItem>,
): Promise<ComplianceReviewRunItem> => {
  const merged: ComplianceReviewRunItem = { ...run, ...patch };
  await putItem<ComplianceReviewRunItem>(
    COMPLIANCE_REVIEW_RUN_PK,
    buildRunSK(run.orgId, run.projectId, run.oppId, run.startedAt, run.reviewId),
    merged,
  );
  return merged;
};

export const markRunReady = async (
  run: ComplianceReviewRunItem,
  findings: ComplianceFinding[],
): Promise<ComplianceReviewRunItem> =>
  updateRun(run, { status: 'READY', findings, finishedAt: nowIso() });

export const markRunFailed = async (
  run: ComplianceReviewRunItem,
  error: string,
): Promise<ComplianceReviewRunItem> =>
  updateRun(run, { status: 'FAILED', error, finishedAt: nowIso() });

/** Look up a run by its reviewId (worker receives orgId/projectId/oppId/reviewId). */
export const getReviewRunById = async (
  orgId: string,
  projectId: string,
  oppId: string,
  reviewId: string,
): Promise<ComplianceReviewRunItem | null> => {
  const items = await queryBySkPrefix<ComplianceReviewRunItem>(
    COMPLIANCE_REVIEW_RUN_PK,
    oppPrefix(orgId, projectId, oppId),
  );
  return items.find((r) => r.reviewId === reviewId) ?? null;
};

// ─── Decision persistence ───────────────────────────────────────────────────

export const upsertFindingDecision = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  fingerprint: string;
  state: FindingDecisionState;
  decidedBy?: string;
  decidedByName?: string;
  note?: string;
}): Promise<FindingDecisionItem> => {
  const { orgId, projectId, oppId, fingerprint, state, decidedBy, decidedByName, note } = args;
  const item: FindingDecisionItem = {
    orgId,
    projectId,
    oppId,
    fingerprint,
    state,
    decidedBy,
    decidedByName,
    decidedAt: nowIso(),
    note,
  };
  await putItem<FindingDecisionItem>(
    COMPLIANCE_FINDING_DECISION_PK,
    buildDecisionSK(orgId, projectId, oppId, fingerprint),
    item,
  );
  return item;
};

export const clearFindingDecision = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  fingerprint: string;
}): Promise<void> => {
  const { orgId, projectId, oppId, fingerprint } = args;
  const tableName = requireEnv('DB_TABLE_NAME');
  // Delete via TransactWrite for a single conditional-free delete.
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: tableName,
            Key: {
              [PK_NAME]: COMPLIANCE_FINDING_DECISION_PK,
              [SK_NAME]: buildDecisionSK(orgId, projectId, oppId, fingerprint),
            },
          },
        },
      ],
    }),
  );
};

export const listFindingDecisions = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<FindingDecisionItem[]> =>
  queryBySkPrefix<FindingDecisionItem>(
    COMPLIANCE_FINDING_DECISION_PK,
    oppPrefix(orgId, projectId, oppId),
  );

// ─── Decision application (pure) ────────────────────────────────────────────

/**
 * Fold persisted decisions into a run's findings by fingerprint.
 *   - dismissed / resolved → tagged with `decisionState`; the UI collapses each
 *     into its own group (Dismissed / Resolved) where the only action is Reopen.
 *   - no decision → left active.
 *
 * NOTE: the read path (get-review) returns raw findings + decisions and the
 * frontend hook (useFindingDecisions) does the folding; this pure helper mirrors
 * that logic for backend callers/tests. Both must stay in agreement.
 */
export interface DecoratedFinding extends ComplianceFinding {
  decisionState?: FindingDecisionState;
}

export const applyDecisionsToFindings = (
  findings: ComplianceFinding[],
  decisions: FindingDecision[],
): { findings: DecoratedFinding[] } => {
  const byFingerprint = new Map(decisions.map((d) => [d.fingerprint, d]));

  const decorated = findings.map((f): DecoratedFinding => {
    const decision = byFingerprint.get(f.fingerprint);
    return decision ? { ...f, decisionState: decision.state } : { ...f };
  });

  return { findings: decorated };
};
