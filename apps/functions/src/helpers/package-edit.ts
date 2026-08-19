/**
 * DynamoDB persistence + proposal engine for Cross-Package AI Editing.
 *
 * One record type (opportunity-scoped):
 *   - Proposal runs  PK PACKAGE_EDIT_RUN  SK {orgId}#{projectId}#{oppId}#{startedAt}#{runId}
 *
 * Lifecycle PROPOSING → PROPOSED | FAILED mirrors ComplianceReviewRun
 * (RUNNING → READY | FAILED). Single active PROPOSING run per opportunity,
 * enforced by an ATOMIC conditional-write lock (a per-opportunity lock item) —
 * NOT a check-then-create, which two concurrent chat turns could both pass,
 * enqueuing two Sonnet scans. Acquiring the lock is compare-and-set (create only
 * if absent or stale); every terminal transition releases it.
 */
import { v4 as uuidv4 } from 'uuid';

import {
  createItem,
  putItem,
  queryBySkPrefix,
  batchDeleteItems,
  deleteItemIf,
  appendToList,
  isConditionalCheckFailed,
} from '@/helpers/db';
import {
  PACKAGE_EDIT_RUN_PK,
  PACKAGE_EDIT_RUN_LOCK_PK,
  RUN_STALE_TIMEOUT_MS,
  RUN_KEEP_COUNT,
  RUN_TTL_DAYS,
} from '@/constants/package-edit';
import { nowIso } from '@/helpers/date';
import { PK_NAME } from '@/constants/common';
import type { PackageEditRun, ProposedEdit } from '@auto-rfp/core';

// ─── Item type (DB row extends the domain shape) ────────────────────────────────

export interface PackageEditRunItem extends PackageEditRun {
  /** Epoch seconds for DynamoDB auto-expiry (retention backstop). */
  ttl?: number;
}

// ─── SK builders (pure) ─────────────────────────────────────────────────────────

const oppPrefix = (orgId: string, projectId: string, oppId: string): string =>
  `${orgId}#${projectId}#${oppId}#`;

export const buildPackageEditRunSk = (
  orgId: string,
  projectId: string,
  oppId: string,
  startedAt: string,
  runId: string,
): string => `${oppPrefix(orgId, projectId, oppId)}${startedAt}#${runId}`;

export const buildPackageEditRunPrefix = (
  orgId: string,
  projectId: string,
  oppId: string,
): string => oppPrefix(orgId, projectId, oppId);

// ─── Staleness (crash-recovery) ─────────────────────────────────────────────────

/** True while a run is PROPOSING and hasn't exceeded the crash-recovery timeout. */
export const isRunActive = (run: PackageEditRun): boolean => {
  if (run.status !== 'PROPOSING') return false;
  const age = Date.now() - new Date(run.startedAt).getTime();
  return age < RUN_STALE_TIMEOUT_MS;
};

/** True for a PROPOSING run that has exceeded the timeout (worker presumed dead). */
export const isRunStale = (run: PackageEditRun): boolean =>
  run.status === 'PROPOSING' &&
  Date.now() - new Date(run.startedAt).getTime() >= RUN_STALE_TIMEOUT_MS;

// ─── Active-run lock (atomic mutual exclusion) ──────────────────────────────────
//
// One lock item per opportunity (fixed SK). Acquisition is a single conditional
// PutItem that succeeds ONLY when no lock exists OR the current lock is stale
// (its owning run exceeded the crash-recovery timeout). Because DynamoDB evaluates
// the condition atomically, two concurrent turns can't both acquire it — exactly
// the guarantee a check-then-create can't give.

interface RunLockItem {
  runId: string;
  startedAt: string;
  /** Epoch seconds; the lock also carries a TTL so an abandoned lock self-heals. */
  ttl?: number;
}

const runLockSk = (orgId: string, projectId: string, oppId: string): string =>
  `${oppPrefix(orgId, projectId, oppId)}LOCK`;

/**
 * Try to acquire the opportunity's active-run lock for `runId`. Returns true on
 * success. Condition: no lock, OR the existing lock's start time is older than the
 * stale timeout (its worker is presumed dead — take it over). Atomic.
 */
const acquireRunLock = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  runId: string;
  startedAt: string;
}): Promise<boolean> => {
  const { orgId, projectId, oppId, runId, startedAt } = args;
  const staleBefore = new Date(Date.now() - RUN_STALE_TIMEOUT_MS).toISOString();
  try {
    await createItem<RunLockItem & { [k: string]: unknown }>(
      PACKAGE_EDIT_RUN_LOCK_PK,
      runLockSk(orgId, projectId, oppId),
      {
        runId,
        startedAt,
        ttl: Math.floor(Date.now() / 1000) + RUN_TTL_DAYS * 86400,
      },
      {
        // Acquire if the lock is absent, or the held lock is stale. `#pk` absence
        // covers a brand-new lock; the startedAt comparison covers takeover of a
        // dead worker's lock (PutItem then replaces the whole lock item atomically).
        condition: 'attribute_not_exists(#pk) OR #startedAt < :staleBefore',
        conditionNames: { '#pk': PK_NAME, '#startedAt': 'startedAt' },
        conditionValues: { ':staleBefore': staleBefore },
      },
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false; // an active lock is held
    throw err;
  }
};

/**
 * Release the lock IFF it's still owned by `runId`. A no-op if the lock was
 * already taken over (stale) by a newer run — the `runId` guard prevents an old
 * run's late terminal transition from freeing a newer run's lock.
 */
const releaseRunLock = async (
  orgId: string,
  projectId: string,
  oppId: string,
  runId: string,
): Promise<void> => {
  await deleteItemIf(
    PACKAGE_EDIT_RUN_LOCK_PK,
    runLockSk(orgId, projectId, oppId),
    '#runId = :runId',
    { '#runId': 'runId' },
    { ':runId': runId },
  ).catch((err) =>
    console.warn('[package-edit] run-lock release failed (non-blocking):', (err as Error)?.message),
  );
};

// ─── Run persistence ─────────────────────────────────────────────────────────────

/** All runs for an opportunity, newest first. */
export const listProposalRuns = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<PackageEditRunItem[]> => {
  const items = await queryBySkPrefix<PackageEditRunItem>(
    PACKAGE_EDIT_RUN_PK,
    oppPrefix(orgId, projectId, oppId),
  );
  return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};

/**
 * Create a new proposal run, guarded so only one run per opportunity can be
 * active at a time. Returns null when an active run already holds the lock (the
 * caller surfaces a 409). Mutual exclusion is an ATOMIC conditional-write lock —
 * two concurrent turns cannot both acquire it (unlike the old check-then-create,
 * which both could pass, enqueuing two scans).
 */
export const createProposalRun = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  instruction: string;
  snapshotVersionIds: Record<string, string>;
}): Promise<PackageEditRunItem | null> => {
  const { orgId, projectId, oppId, instruction, snapshotVersionIds } = args;

  const startedAt = nowIso();
  const runId = uuidv4();

  // Atomically claim the single active-run slot. If another turn holds a non-stale
  // lock, this fails and we return null — no run row is written, no scan enqueued.
  const acquired = await acquireRunLock({ orgId, projectId, oppId, runId, startedAt });
  if (!acquired) return null;

  let item: PackageEditRunItem;
  try {
    item = await createItem<PackageEditRunItem>(
      PACKAGE_EDIT_RUN_PK,
      buildPackageEditRunSk(orgId, projectId, oppId, startedAt, runId),
      {
        runId,
        orgId,
        projectId,
        oppId,
        status: 'PROPOSING',
        instruction,
        proposals: [],
        appliedEditIds: [],
        snapshotVersionIds,
        startedAt,
        ttl: Math.floor(Date.now() / 1000) + RUN_TTL_DAYS * 86400,
      },
    );
  } catch (err) {
    // The run row didn't land — free the lock we just took so the opportunity
    // isn't wedged until the stale timeout, then propagate.
    await releaseRunLock(orgId, projectId, oppId, runId);
    throw err;
  }

  // Prune to the most recent RUN_KEEP_COUNT. Best-effort — failures here must not
  // block the flow. TTL is the backstop. (Read the list AFTER the write so the new
  // run is included; the lock, on its own PK, is never in this list.)
  const existingRuns = await listProposalRuns(orgId, projectId, oppId);
  const toPrune = existingRuns.slice(RUN_KEEP_COUNT);
  if (toPrune.length) {
    await batchDeleteItems(
      toPrune.map((r) => ({
        pk: PACKAGE_EDIT_RUN_PK,
        sk: buildPackageEditRunSk(r.orgId, r.projectId, r.oppId, r.startedAt, r.runId),
      })),
    ).catch((err) =>
      console.warn('[package-edit] run prune failed (non-blocking):', (err as Error)?.message),
    );
  }

  return item;
};

/** Most recent run for an opportunity (by startedAt), or null. */
export const getLatestProposalRun = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<PackageEditRunItem | null> => {
  const items = await listProposalRuns(orgId, projectId, oppId);
  return items[0] ?? null;
};

/** Look up a run by its runId (worker receives orgId/projectId/oppId/runId). */
export const getProposalRunById = async (
  orgId: string,
  projectId: string,
  oppId: string,
  runId: string,
): Promise<PackageEditRunItem | null> => {
  const items = await listProposalRuns(orgId, projectId, oppId);
  return items.find((r) => r.runId === runId) ?? null;
};

const updateRun = async (
  run: PackageEditRunItem,
  patch: Partial<PackageEditRunItem>,
): Promise<PackageEditRunItem> => {
  const merged: PackageEditRunItem = { ...run, ...patch };
  await putItem<PackageEditRunItem>(
    PACKAGE_EDIT_RUN_PK,
    buildPackageEditRunSk(run.orgId, run.projectId, run.oppId, run.startedAt, run.runId),
    merged,
  );
  return merged;
};

export const markRunProposed = async (
  run: PackageEditRunItem,
  proposals: ProposedEdit[],
  summary?: string,
): Promise<PackageEditRunItem> => {
  const updated = await updateRun(run, {
    status: 'PROPOSED',
    proposals,
    finishedAt: nowIso(),
    ...(summary ? { summary } : {}),
  });
  // Terminal transition → free the active-run slot (only if still ours).
  await releaseRunLock(run.orgId, run.projectId, run.oppId, run.runId);
  return updated;
};

export const markRunFailed = async (
  run: PackageEditRunItem,
  error: string,
): Promise<PackageEditRunItem> => {
  const updated = await updateRun(run, { status: 'FAILED', error, finishedAt: nowIso() });
  // Terminal transition → free the active-run slot (only if still ours). Covers
  // both worker failure and the get-run crash-recovery path.
  await releaseRunLock(run.orgId, run.projectId, run.oppId, run.runId);
  return updated;
};

/**
 * Record editIds that were successfully applied from this run. Lets the UI show
 * only genuinely-remaining proposals after an apply. Status stays PROPOSED (the
 * run can still have un-applied proposals to review/apply later).
 *
 * Uses an ATOMIC list_append on `appliedEditIds` rather than a read-modify-write
 * full-item overwrite: two concurrent applies to the same run would otherwise be
 * last-write-wins, dropping one writer's ids (and clobbering any sibling field a
 * racing write touched). Appending server-side keeps both writers' ids. The list
 * can then hold duplicates (each writer appends its own), but every consumer
 * treats appliedEditIds as a SET (`new Set(appliedEditIds)`), so that's benign.
 */
export const markEditsApplied = async (
  run: PackageEditRunItem,
  editIds: string[],
): Promise<PackageEditRunItem> => {
  // Skip ids already recorded in the snapshot we were handed (cheap same-request
  // dedupe); genuinely-concurrent appends are deduped by consumers on read.
  const known = new Set(run.appliedEditIds ?? []);
  const toAppend = Array.from(new Set(editIds)).filter((id) => !known.has(id));
  if (toAppend.length === 0) return run;
  return appendToList<PackageEditRunItem>(
    PACKAGE_EDIT_RUN_PK,
    buildPackageEditRunSk(run.orgId, run.projectId, run.oppId, run.startedAt, run.runId),
    'appliedEditIds',
    toAppend,
  );
};
