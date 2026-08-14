/**
 * Version history for file-based XLSX questionnaires.
 *
 * Mirrors `required-form-version.ts`, but the snapshot payload is the .xlsx FILE
 * (copied to its own S3 key) rather than a gzipped fields array — questionnaires
 * have no fields array and the file can be many MB. Each version row carries the
 * `snapshotFileKey` of the pre-write copy; pruning deletes BOTH the row AND its
 * S3 object.
 *
 * Snapshot is called BEFORE every mutating questionnaire write so the change is
 * revertible (parity with forms + RFP documents).
 */
import { v4 as uuidv4 } from 'uuid';

import { createItem, DBItem, queryAllBySkPrefix, getItem, batchDeleteItems, isConditionalCheckFailed } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import { copyS3Object, deleteS3Object } from '@/helpers/s3';
import { NotFoundError } from '@/helpers/error';
import { getRFPDocument } from '@/helpers/rfp-document';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import {
  QUESTIONNAIRE_VERSION_PK,
  QUESTIONNAIRE_VERSION_KEY_PREFIX,
  QUESTIONNAIRE_VERSION_KEEP_COUNT,
} from '@/constants/questionnaire-version';

import type { QuestionnaireVersion, QuestionnaireVersionSource } from '@auto-rfp/core';

export type QuestionnaireVersionDBItem = QuestionnaireVersion & DBItem;

const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

// Bounded retries when two concurrent snapshots race for the same version number.
const SNAPSHOT_MAX_ATTEMPTS = 5;

// ─── SK builders (pure) ────────────────────────────────────────────────────────

export const buildQuestionnaireVersionSk = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
): string =>
  `${orgId}#${projectId}#${opportunityId}#${documentId}#${String(versionNumber).padStart(6, '0')}`;

export const buildQuestionnaireVersionPrefix = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${documentId}#`;

/** S3 key for a snapshot copy of a questionnaire's .xlsx at a given version. */
const buildSnapshotFileKey = (documentId: string, versionNumber: number): string =>
  `${QUESTIONNAIRE_VERSION_KEY_PREFIX}/${documentId}/v${versionNumber}.xlsx`;

/**
 * Org-isolation guard for a fetched RFP-document record (M2). getRFPDocument's SK
 * has no orgId, so callers that then read/overwrite the doc's file must verify it
 * belongs to the caller's org rather than rely on incidental downstream checks.
 * The fileKey is org-prefixed (`{orgId}/…`) and IS the object being written, so
 * its prefix is authoritative; a persisted `doc.orgId`, when present, must match too.
 */
export const docBelongsToOrg = (
  doc: { fileKey?: unknown; orgId?: unknown } | null | undefined,
  orgId: string,
): boolean => {
  const fileKey = typeof doc?.fileKey === 'string' ? doc.fileKey : '';
  if (!fileKey.startsWith(`${orgId}/`)) return false;
  const docOrgId = typeof doc?.orgId === 'string' ? doc.orgId : undefined;
  return !docOrgId || docOrgId === orgId;
};

const stripKeys = (item: QuestionnaireVersionDBItem): QuestionnaireVersion => {
  const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...rest } = item;
  return rest;
};

// ─── Reads ───────────────────────────────────────────────────────────────────

export const listQuestionnaireVersions = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<QuestionnaireVersion[]> => {
  const prefix = buildQuestionnaireVersionPrefix(orgId, projectId, opportunityId, documentId);
  // Paginate so a full page (1 MB) never silently truncates the ascending-SK rows
  // and drops the NEWEST versions — the latest-number lookup relies on seeing them.
  const items = await queryAllBySkPrefix<QuestionnaireVersionDBItem>(QUESTIONNAIRE_VERSION_PK, prefix);
  return items.map(stripKeys).sort((a, b) => b.versionNumber - a.versionNumber);
};

export const getQuestionnaireVersion = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  versionNumber: number,
): Promise<QuestionnaireVersion | null> => {
  const sk = buildQuestionnaireVersionSk(orgId, projectId, opportunityId, documentId, versionNumber);
  const item = await getItem<QuestionnaireVersionDBItem>(QUESTIONNAIRE_VERSION_PK, sk);
  return item ? stripKeys(item) : null;
};

const getLatestVersionNumber = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<number> => {
  const versions = await listQuestionnaireVersions(orgId, projectId, opportunityId, documentId);
  return versions.length > 0 ? versions[0].versionNumber : 0;
};

// ─── Snapshot (called BEFORE every mutating questionnaire write) ────────────────

/**
 * Copy the questionnaire's CURRENT .xlsx to a version key, write a version row,
 * then prune to the newest N (deleting older rows AND their S3 objects). Returns
 * the new version number. Callers wrap in try/catch — the snapshot is best-effort
 * history and must not fail the user's write.
 */
export const snapshotQuestionnaire = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  documentId: string;
  currentFileKey: string;
  source: QuestionnaireVersionSource;
  userId?: string;
  userName?: string;
  changeNote?: string;
  /**
   * Version numbers the subsequent prune must NOT delete, even if they fall
   * outside the keep window. Used by revert: the snapshot's prune runs BEFORE
   * the target snapshot is copied back onto the live file, so pruning the target
   * (the oldest version, at the 30-version cap) would delete the very S3 object
   * the restore reads next → NoSuchKey and permanent loss of that version.
   */
  protectVersions?: number[];
}): Promise<number> => {
  const { orgId, projectId, oppId, documentId, currentFileKey, source, userId, userName, changeNote, protectVersions } = args;
  const bucket = getDocumentsBucket();

  // The version number comes from an eventually-consistent read, so two concurrent
  // snapshots (e.g. a save racing a revert) can compute the same next number and
  // collide on createItem's `attribute_not_exists` guard. That's a lost race, not
  // a fault — recompute and retry a bounded number of times. The S3 copy key is
  // derived from the version number, so it's recomputed inside the loop too.
  let nextVersion = 0;
  for (let attempt = 0; attempt < SNAPSHOT_MAX_ATTEMPTS; attempt++) {
    nextVersion = (await getLatestVersionNumber(orgId, projectId, oppId, documentId)) + 1;
    const snapshotFileKey = buildSnapshotFileKey(documentId, nextVersion);

    // Copy the live file to the version key BEFORE recording the row, so a row
    // never points at a missing object.
    await copyS3Object(bucket, currentFileKey, snapshotFileKey);

    const version: QuestionnaireVersion = {
      versionId: uuidv4(),
      documentId,
      orgId,
      projectId,
      opportunityId: oppId,
      versionNumber: nextVersion,
      snapshotFileKey,
      source,
      ...(changeNote ? { changeNote } : {}),
      ...(userId ? { createdBy: userId } : {}),
      ...(userName ? { createdByName: userName } : {}),
      createdAt: nowIso(),
    };

    try {
      await createItem<QuestionnaireVersionDBItem>(
        QUESTIONNAIRE_VERSION_PK,
        buildQuestionnaireVersionSk(orgId, projectId, oppId, documentId, nextVersion),
        version as QuestionnaireVersionDBItem,
      );
      break; // won the slot
    } catch (err) {
      // A conditional failure means a concurrent WINNER already wrote the row for
      // this version, and (since the key is derived from the version number) its
      // row references the SAME snapshotFileKey we just copied — so we must NOT
      // delete it. Retry with a fresh number if attempts remain.
      if (isConditionalCheckFailed(err)) {
        if (attempt < SNAPSHOT_MAX_ATTEMPTS - 1) continue;
        throw err;
      }
      // Any OTHER failure: our row never landed, so the object we just copied is
      // orphaned (prune only cleans objects that have a row). Best-effort remove
      // it before propagating, so a transient write fault doesn't leak storage.
      await deleteS3Object(bucket, snapshotFileKey).catch((delErr) =>
        console.warn('[questionnaire-version] failed to clean up orphaned snapshot object:', (delErr as Error)?.message),
      );
      throw err;
    }
  }

  // Prune is best-effort maintenance and runs AFTER the version row is committed.
  // It must never mask a successful snapshot: if it threw here, the caller (e.g.
  // revert) would treat a committed snapshot as a failure and abort with a
  // misleading "could not snapshot" message. A skipped prune just leaves the store
  // one row over the cap; the next mutating write prunes it back down.
  await pruneQuestionnaireVersions(orgId, projectId, oppId, documentId, protectVersions).catch((err) =>
    console.warn('[questionnaire-version] prune failed (snapshot still committed):', (err as Error)?.message),
  );
  return nextVersion;
};

const pruneQuestionnaireVersions = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  protectVersions?: number[],
): Promise<void> => {
  const versions = await listQuestionnaireVersions(orgId, projectId, opportunityId, documentId); // newest first
  if (versions.length <= QUESTIONNAIRE_VERSION_KEEP_COUNT) return;
  // Never prune a protected version (e.g. a revert's target, whose S3 object is
  // about to be read back). Excluding it can leave the store one over the cap for
  // this write; the next mutating write prunes it back down. Correctness (not
  // losing the object we're restoring) wins over holding the cap exactly.
  const protectedSet = new Set(protectVersions ?? []);
  const stale = versions
    .slice(QUESTIONNAIRE_VERSION_KEEP_COUNT)
    .filter((v) => !protectedSet.has(v.versionNumber));
  if (stale.length === 0) return;
  const bucket = getDocumentsBucket();

  await batchDeleteItems(
    stale.map((v) => ({
      pk: QUESTIONNAIRE_VERSION_PK,
      sk: buildQuestionnaireVersionSk(orgId, projectId, opportunityId, documentId, v.versionNumber),
    })),
  );
  // Best-effort delete the pruned snapshot objects (never fail pruning on this).
  await Promise.all(stale.map((v) => deleteS3Object(bucket, v.snapshotFileKey)));
};

// ─── Revert ────────────────────────────────────────────────────────────────────

/**
 * Revert a questionnaire to a prior version's file. Snapshots the CURRENT file
 * first (source SYSTEM) so the revert itself is undoable, then copies the target
 * version's snapshot back onto the live `fileKey`. Returns the pre-revert snapshot
 * version number.
 */
export const revertQuestionnaireToVersion = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  targetVersion: number;
  userId?: string;
  userName?: string;
  /** Optional user note; appended to the auto "Revert to version N" context. */
  changeNote?: string;
}): Promise<{ snapshotVersionNumber: number; fileKey: string }> => {
  const { orgId, projectId, opportunityId, documentId, targetVersion, userId, userName, changeNote } = args;
  const bucket = getDocumentsBucket();

  const doc = await getRFPDocument(projectId, opportunityId, documentId);
  // Org isolation (M2): getRFPDocument's SK has no orgId, so verify the doc
  // belongs to the caller's org before reading/overwriting its file.
  if (!doc || !doc.fileKey || !docBelongsToOrg(doc, orgId)) throw new NotFoundError('Questionnaire not found');
  const fileKey = doc.fileKey as string;

  const target = await getQuestionnaireVersion(orgId, projectId, opportunityId, documentId, targetVersion);
  if (!target) throw new NotFoundError(`Questionnaire version ${targetVersion} not found`);

  // Keep the "which version" context, and append the user's note when supplied
  // (bounded so the combined note can't exceed the schema's 500-char cap).
  const note = changeNote?.trim()
    ? `Revert to version ${targetVersion}: ${changeNote.trim()}`.slice(0, 500)
    : `Revert to version ${targetVersion}`;

  // Snapshot the pre-revert file — REQUIRED, not best-effort. The revert below
  // OVERWRITES the live file; if the snapshot fails and we proceed, the current
  // file is gone with no way back. So if the snapshot throws, abort the revert
  // and surface the error rather than overwrite. (snapshotQuestionnaire already
  // retries the version-number race internally before it would throw.)
  let snapshotVersionNumber = 0;
  try {
    snapshotVersionNumber = await snapshotQuestionnaire({
      orgId,
      projectId,
      oppId: opportunityId,
      documentId,
      currentFileKey: fileKey,
      source: 'SYSTEM',
      userId,
      userName,
      changeNote: note,
      // The pre-revert snapshot's prune runs before we copy the target back onto
      // the live file. At the 30-version cap, reverting to the oldest version
      // would otherwise prune (and S3-delete) the target itself → the copy below
      // would throw NoSuchKey and lose that version. Protect it from this prune.
      protectVersions: [targetVersion],
    });
  } catch (snapErr) {
    throw new Error(
      `Revert aborted: could not snapshot current questionnaire file before overwriting it ` +
        `(${(snapErr as Error)?.message ?? 'unknown error'})`,
    );
  }

  // Restore the target snapshot onto the live file. The questionnaire's content
  // IS this .xlsx (keyed by the unchanged fileKey), so overwriting it is the
  // revert — no document-record field changes.
  await copyS3Object(bucket, target.snapshotFileKey, fileKey);

  return { snapshotVersionNumber, fileKey };
};
