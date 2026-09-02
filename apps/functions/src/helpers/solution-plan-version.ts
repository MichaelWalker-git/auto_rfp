/**
 * solution-plan-version.ts
 *
 * Storage helpers for the Solution Plan version history (contract C3,
 * solution-plan-versioning u1). One immutable record per content-producing
 * plan write; the HTML body lives in S3 under the version's OWN
 * `htmlContentKey` (written by the triggering write — capture never uploads).
 *
 * Key semantics (rules.md BR1–BR6, nfr-design):
 *  - capture is FAIL-OPEN: one try/catch around attribution + insert + prune;
 *    on failure it logs `solution_plan_version_capture_failed`, reports to
 *    Sentry EXPLICITLY (the withSentryLambda wrapper never sees swallowed
 *    errors), and returns normally — never into the caller's write path (BR5.1)
 *  - the insert is CREATE-ONLY per plan+versionNumber; a duplicate attempt is
 *    a silent no-op success, not an error (BR5.2 — worker redelivery)
 *  - insert-then-prune is deliberately non-atomic; the prune loop removes as
 *    many OLDEST records as needed until ≤30, healing a transient 31 left by a
 *    previously failed prune (BR4.1); the newest is structurally exempt (BR4.3)
 *  - every removal deletes the record FIRST, then its S3 body — a failure
 *    between the two leaves a cheap orphaned object instead of a dangling
 *    record, and a missing body is tolerated (BR4.2, reliability design)
 */

import { v4 as uuidv4 } from 'uuid';

import {
  SYSTEM_CREATED_BY,
  SYSTEM_CREATED_BY_NAME,
  type SolutionPlanCostSchedule,
  type SolutionPlanKey,
  type SolutionPlanVersionDBItem,
  type SolutionPlanVersionItem,
  type SolutionPlanVersionListItem,
  type SolutionPlanVersionOrigin,
} from '@auto-rfp/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import {
  SOLUTION_PLAN_VERSION_KEEP_COUNT,
  SOLUTION_PLAN_VERSION_PK,
} from '@/constants/solution-plan';
import { Sentry } from '@/sentry-lambda';
import {
  createItem,
  deleteItem,
  isConditionalCheckFailed,
  queryAllBySkPrefix,
  setOrRemoveAttribute,
} from './db';
import { deleteS3Object } from './s3';
import { requireEnv } from './env';
import { nowIso } from './date';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── Sort key builders (pure) ───────────────────────────────────────────────────

/** Zero-pad a version number so SKs sort numerically (3 → "000003"). */
export const padSolutionPlanVersionNumber = (versionNumber: number): string =>
  String(versionNumber).padStart(6, '0');

/**
 * Version SK: `{orgId}#{projectId}#{opportunityId}#{versionNumber:6pad}` —
 * scoped to the plan's tenant key space (NFR3.1), ascending SK order equals
 * oldest-first (the 6-padded counter tail).
 */
export const buildSolutionPlanVersionSk = (key: SolutionPlanKey, versionNumber: number): string =>
  `${key.orgId}#${key.projectId}#${key.opportunityId}#${padSolutionPlanVersionNumber(versionNumber)}`;

/** SK prefix for querying all versions of a plan. */
export const buildSolutionPlanVersionSkPrefix = (key: SolutionPlanKey): string =>
  `${key.orgId}#${key.projectId}#${key.opportunityId}#`;

// ─── Internal utilities ─────────────────────────────────────────────────────────

/** Strip the single-table keys off a DB record → the pure domain item. */
const stripKeys = (dbItem: SolutionPlanVersionDBItem): SolutionPlanVersionItem => {
  const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...item } = dbItem;
  return item;
};

/** All version records of a plan, oldest first (ascending 6-padded SK). */
const queryVersionRecords = async (key: SolutionPlanKey): Promise<SolutionPlanVersionDBItem[]> => {
  const items = await queryAllBySkPrefix<SolutionPlanVersionDBItem>(
    SOLUTION_PLAN_VERSION_PK,
    buildSolutionPlanVersionSkPrefix(key),
  );
  return items.sort((a, b) => a.versionNumber - b.versionNumber);
};

/** What a removal needs: the record's exact SK and its own body key. */
type VersionRemovalTarget = Pick<SolutionPlanVersionDBItem, typeof SK_NAME | 'htmlContentKey'>;

/**
 * Delete one version: record FIRST, then its own S3 body. `deleteS3Object` is
 * best-effort and a missing body is tolerated, so a retried removal converges
 * (reliability design; project practice cid:nfr-design:c4).
 */
const removeVersion = async (record: VersionRemovalTarget): Promise<void> => {
  await deleteItem(SOLUTION_PLAN_VERSION_PK, record[SK_NAME]);
  await deleteS3Object(DOCUMENTS_BUCKET, record.htmlContentKey);
};

// ─── Capture (fail-open, BR5.1) ─────────────────────────────────────────────────

export type CaptureSolutionPlanVersionInput = {
  key: SolutionPlanKey;
  solutionPlanId: string;
  /** The plan's internal counter AFTER the triggering write's bump (BR2.2). */
  versionNumber: number;
  /** S3 key of THIS version's own body, produced by the triggering write (BR2.1). */
  htmlContentKey: string;
  /** Cost schedule as of the captured write; absent when that write cleared it. */
  costScheduleSnapshot?: SolutionPlanCostSchedule | null;
  origin: SolutionPlanVersionOrigin;
  /**
   * Resolved attribution: the authenticated caller (manual-save/restore,
   * BR3.1) or the plan's initiator stamp (generation, BR6.2). When absent the
   * system sentinel applies with a logged warning (BR3.3).
   */
  createdBy?: string;
  createdByName?: string;
};

/**
 * Record one SolutionPlanVersion, then prune the plan's history to the 30
 * newest. NEVER throws into the caller's write path — any failure is logged,
 * reported to Sentry explicitly, and swallowed (BR5.1/NFR1.6). The BR5.2
 * duplicate no-op is NOT a failure: no log, no Sentry.
 *
 * Returns the created record so callers that answer the client synchronously
 * (u3's restore, C2 `newVersion`) can project it — additive enrichment, the
 * fail-open contract is unchanged. Null when no record was created by THIS
 * call: the BR5.2 duplicate no-op (another attempt won the create-only race)
 * or a fail-open insert failure. A prune failure after a committed insert
 * still returns the record (the insert succeeded).
 */
export const captureSolutionPlanVersion = async (
  input: CaptureSolutionPlanVersionInput,
): Promise<SolutionPlanVersionItem | null> => {
  const { key, origin, versionNumber } = input;
  let created: SolutionPlanVersionItem | null = null;
  try {
    // ── Attribution (BR3.1/BR3.2 with the BR3.3 sentinel fallback) ──
    let createdBy = input.createdBy;
    let createdByName = input.createdByName;
    if (!createdBy) {
      createdBy = SYSTEM_CREATED_BY;
      createdByName = SYSTEM_CREATED_BY_NAME;
      console.warn(
        JSON.stringify({
          event: 'solution_plan_version_missing_initiator_stamp',
          ...key,
          origin,
          versionNumber,
        }),
      );
    }

    // ── Create-only insert (BR5.2 — createItem's default condition is
    //    attribute_not_exists on both keys) ──
    const record: SolutionPlanVersionItem = {
      versionId: uuidv4(),
      versionNumber,
      orgId: key.orgId,
      projectId: key.projectId,
      opportunityId: key.opportunityId,
      solutionPlanId: input.solutionPlanId,
      htmlContentKey: input.htmlContentKey,
      ...(input.costScheduleSnapshot ? { costScheduleSnapshot: input.costScheduleSnapshot } : {}),
      origin,
      createdBy,
      createdByName: createdByName ?? createdBy,
      createdAt: nowIso(),
    };
    try {
      await createItem<SolutionPlanVersionDBItem>(
        SOLUTION_PLAN_VERSION_PK,
        buildSolutionPlanVersionSk(key, versionNumber),
        record,
      );
    } catch (err) {
      // A record for this plan+counter already exists (worker redelivery race)
      // — the design working correctly, treated as success (BR5.2).
      if (isConditionalCheckFailed(err)) return null;
      throw err;
    }
    created = record;

    // ── Prune to the retention cap (BR4.1) ──
    await pruneSolutionPlanVersions(key);
    return created;
  } catch (err) {
    const failure = err as { name?: string; message?: string };
    console.error(
      JSON.stringify({
        event: 'solution_plan_version_capture_failed',
        ...key,
        origin,
        versionNumber,
        failureReason: `${failure?.name ?? 'Error'}: ${failure?.message ?? String(err)}`,
      }),
    );
    // Explicit report — capture swallows its errors, so the withSentryLambda
    // wrapper (unhandled errors only) can never see this failure (NFR1.6).
    Sentry.captureException(err, {
      tags: { feature: 'solution-plan-versioning', origin },
    });
    // Swallow — fail-open by contract (BR5.1); the plan write already succeeded.
    // A committed insert survives a later prune failure: the record exists.
    return created;
  }
};

/**
 * Remove OLDEST records (and their bodies) until count ≤ 30. Removes as many
 * as needed, not exactly one — a transient 31 left by a previously failed
 * prune heals here (BR4.1). The newest record is structurally exempt (BR4.3).
 */
const pruneSolutionPlanVersions = async (key: SolutionPlanKey): Promise<void> => {
  // Slim projection (performance design NFR2.1): the retention check never
  // pays for item bodies — only the SK and the body key a removal needs.
  const records = (
    await queryAllBySkPrefix<VersionRemovalTarget>(
      SOLUTION_PLAN_VERSION_PK,
      buildSolutionPlanVersionSkPrefix(key),
      '#sk, htmlContentKey',
      { '#sk': SK_NAME },
    )
  ).sort((a, b) => (a[SK_NAME] < b[SK_NAME] ? -1 : 1)); // oldest first
  if (records.length <= SOLUTION_PLAN_VERSION_KEEP_COUNT) return;

  const overflow = records.slice(0, records.length - SOLUTION_PLAN_VERSION_KEEP_COUNT);
  for (const record of overflow) {
    await removeVersion(record);
  }

  console.log(
    JSON.stringify({
      event: 'solution_plan_version_pruned',
      ...key,
      removedCount: overflow.length,
      remainingCount: records.length - overflow.length,
    }),
  );
};

// ─── Reads (consumed by u2) ─────────────────────────────────────────────────────

/**
 * Pure projection to the C1 list-item shape (u2 response semantics) — strips
 * storage-only fields such as `htmlContentKey` so the body reference never
 * leaves the backend (content isolation, u2 security design NFR3.8).
 */
export const toSolutionPlanVersionListItem = (
  item: SolutionPlanVersionItem,
): SolutionPlanVersionListItem => ({
  versionId: item.versionId,
  versionNumber: item.versionNumber,
  origin: item.origin,
  ...(item.label != null ? { label: item.label } : {}),
  createdBy: item.createdBy,
  createdByName: item.createdByName,
  createdAt: item.createdAt,
});

/** A plan's versions, newest first, at most 30 (contract C3). */
export const listSolutionPlanVersions = async (
  key: SolutionPlanKey,
): Promise<SolutionPlanVersionItem[]> => {
  const records = await queryVersionRecords(key);
  return records.slice(-SOLUTION_PLAN_VERSION_KEEP_COUNT).reverse().map(stripKeys);
};

/** One version by versionId within the plan's scope; null → 404 semantics. */
export const getSolutionPlanVersion = async (
  key: SolutionPlanKey,
  versionId: string,
): Promise<SolutionPlanVersionItem | null> => {
  const records = await queryVersionRecords(key);
  const match = records.find((record) => record.versionId === versionId);
  return match ? stripKeys(match) : null;
};

// ─── Label (the single mutable attribute) ───────────────────────────────────────

/**
 * Set or clear a version's label — the ONLY post-creation mutation the helper
 * layer exposes (attribution/content immutability by omission, NFR3.2).
 * A non-empty label SETs the attribute; empty/whitespace/null REMOVEs it.
 * Returns the updated item, or null when the version no longer exists (404).
 */
export const setSolutionPlanVersionLabel = async (
  key: SolutionPlanKey,
  versionId: string,
  label: string | null | undefined,
): Promise<SolutionPlanVersionItem | null> => {
  const records = await queryVersionRecords(key);
  const target = records.find((record) => record.versionId === versionId);
  if (!target) return null;

  const trimmed = label?.trim();
  const updated = await setOrRemoveAttribute<SolutionPlanVersionDBItem>(
    SOLUTION_PLAN_VERSION_PK,
    target[SK_NAME],
    'label',
    trimmed ? trimmed : undefined,
  );
  return updated ? stripKeys(updated) : null;
};

// ─── Delete (consumed by u2) ────────────────────────────────────────────────────

export type DeleteSolutionPlanVersionResult =
  | { outcome: 'DELETED' }
  | { outcome: 'NOT_FOUND' }
  /** The newest (current) version is never deletable (BR4.3 / C1 409). */
  | { outcome: 'REFUSED_CURRENT' };

/**
 * Delete a non-current version: locate → newest-guard → record first → body
 * second (missing body tolerated — `deleteS3Object` is best-effort, so a
 * retry after a half-failure converges).
 */
export const deleteSolutionPlanVersion = async (
  key: SolutionPlanKey,
  versionId: string,
): Promise<DeleteSolutionPlanVersionResult> => {
  const records = await queryVersionRecords(key); // oldest first
  const target = records.find((record) => record.versionId === versionId);
  if (!target) return { outcome: 'NOT_FOUND' };

  const newest = records[records.length - 1];
  if (newest.versionId === target.versionId) return { outcome: 'REFUSED_CURRENT' };

  await removeVersion(target);
  return { outcome: 'DELETED' };
};
