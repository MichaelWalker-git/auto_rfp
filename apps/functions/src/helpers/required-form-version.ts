import { gzipSync, gunzipSync } from 'node:zlib';

import { v4 as uuidv4 } from 'uuid';

import { createItem, DBItem, queryAllBySkPrefix, getItem, batchDeleteItems, isConditionalCheckFailed } from './db';
import { nowIso } from './date';
import { NotFoundError } from './error';
import { getRequiredForm, updateRequiredForm, type RequiredFormDBItem } from './required-form';
import { PK_NAME, SK_NAME } from '../constants/common';
import {
  REQUIRED_FORM_VERSION_PK,
  FORM_VERSION_KEEP_COUNT,
} from '../constants/required-form-version';

import type {
  DetectedFormField,
  RequiredFormVersion,
  RequiredFormVersionSource,
} from '@auto-rfp/core';

export type RequiredFormVersionDBItem = RequiredFormVersion & DBItem;

// ─── Field compression ───────────────────────────────────────────────────────
//
// A version snapshot stores the whole `fields` array, which for large XLSX
// matrices can be hundreds of KB — the same overflow problem `required-form.ts`
// solves. Store the compressed bytes in a binary `fieldsGz` attribute and keep
// the inline `fields` array empty; reads transparently decompress.

const FIELDS_GZ_ATTR = 'fieldsGz';
const MAX_FIELDS_GZ_BYTES = 380_000;

// Bounded retries when two concurrent snapshots race for the same version number.
const SNAPSHOT_MAX_ATTEMPTS = 5;

type StoredFormVersion = RequiredFormVersionDBItem & { [FIELDS_GZ_ATTR]?: Uint8Array };

const encodeFields = (fields: DetectedFormField[]): Uint8Array => {
  const gz = gzipSync(Buffer.from(JSON.stringify(fields), 'utf-8'));
  if (gz.byteLength > MAX_FIELDS_GZ_BYTES) {
    throw new Error(
      `Compressed form-version fields (${gz.byteLength} bytes) exceed the DynamoDB item budget ` +
        `(${MAX_FIELDS_GZ_BYTES} bytes); snapshot has ${fields.length} fields`,
    );
  }
  return new Uint8Array(gz);
};

const decodeFields = (raw: Uint8Array): DetectedFormField[] => {
  const json = gunzipSync(raw).toString('utf-8');
  return JSON.parse(json) as DetectedFormField[];
};

const decodeStoredVersion = (item: StoredFormVersion): RequiredFormVersion => {
  const { [FIELDS_GZ_ATTR]: gz, [PK_NAME]: _pk, [SK_NAME]: _sk, ...rest } = item;
  const fields = gz != null ? decodeFields(gz) : (rest.fields ?? []);
  return { ...rest, fields };
};

// ─── SK Builders (pure) ────────────────────────────────────────────────────────

export const buildRequiredFormVersionSk = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  formId: string,
  versionNumber: number,
): string =>
  `${orgId}#${projectId}#${opportunityId}#${formId}#${String(versionNumber).padStart(6, '0')}`;

export const buildRequiredFormVersionPrefix = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  formId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${formId}#`;

// ─── Reads ───────────────────────────────────────────────────────────────────

export const listFormVersions = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  formId: string,
): Promise<RequiredFormVersion[]> => {
  const prefix = buildRequiredFormVersionPrefix(orgId, projectId, opportunityId, formId);
  // Paginate: each row can carry up to ~380 KB of compressed fields, so a single
  // QueryCommand page (1 MB) holds only a handful of versions. Since the SK sorts
  // ascending (oldest first), a non-paginated read would silently drop the NEWEST
  // versions — breaking history/revert and the latest-number lookup below.
  const items = await queryAllBySkPrefix<StoredFormVersion>(REQUIRED_FORM_VERSION_PK, prefix);
  return items
    .map((i) => decodeStoredVersion(i))
    .sort((a, b) => b.versionNumber - a.versionNumber);
};

/**
 * Key-only projection of every version number for a form (paginated). Used by the
 * latest-number and prune paths so they never hydrate the megabytes of compressed
 * `fieldsGz` payloads just to compute a max or a delete list.
 */
const listFormVersionNumbers = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  formId: string,
): Promise<number[]> => {
  const prefix = buildRequiredFormVersionPrefix(orgId, projectId, opportunityId, formId);
  const items = await queryAllBySkPrefix<{ versionNumber: number }>(
    REQUIRED_FORM_VERSION_PK,
    prefix,
    '#vn',
    { '#vn': 'versionNumber' },
  );
  return items.map((i) => i.versionNumber);
};

export const getFormVersion = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  formId: string,
  versionNumber: number,
): Promise<RequiredFormVersion | null> => {
  const sk = buildRequiredFormVersionSk(orgId, projectId, opportunityId, formId, versionNumber);
  const item = await getItem<StoredFormVersion>(REQUIRED_FORM_VERSION_PK, sk);
  return item ? decodeStoredVersion(item) : null;
};

const getLatestFormVersionNumber = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  formId: string,
): Promise<number> => {
  const numbers = await listFormVersionNumbers(orgId, projectId, opportunityId, formId);
  return numbers.length > 0 ? Math.max(...numbers) : 0;
};

// ─── Snapshot (called BEFORE every mutating form write) ────────────────────────

/**
 * Write a version snapshot of the form's CURRENT fields, then prune to the newest
 * N. Returns the new version number. Callers that must not fail the user's write
 * on a snapshot error should wrap this in try/catch (snapshot is best-effort
 * history — the write is the priority).
 */
export const snapshotFormFields = async (args: {
  form: Pick<RequiredFormDBItem, 'orgId' | 'projectId' | 'opportunityId' | 'formId' | 'fields'>;
  source: RequiredFormVersionSource;
  userId?: string;
  userName?: string;
  changeNote?: string;
}): Promise<number> => {
  const { form, source, userId, userName, changeNote } = args;
  const fieldsGz = encodeFields(form.fields ?? []);

  // The version number is derived from an eventually-consistent read, so two
  // concurrent snapshots (e.g. a save racing a revert) can compute the SAME next
  // number; createItem's `attribute_not_exists` guard then throws
  // ConditionalCheckFailedException for the loser. That's a lost race, not a
  // fault — recompute the next number and retry a bounded number of times.
  let nextVersion = 0;
  for (let attempt = 0; attempt < SNAPSHOT_MAX_ATTEMPTS; attempt++) {
    nextVersion =
      (await getLatestFormVersionNumber(form.orgId, form.projectId, form.opportunityId, form.formId)) + 1;

    const version: RequiredFormVersion = {
      versionId: uuidv4(),
      formId: form.formId,
      orgId: form.orgId,
      projectId: form.projectId,
      opportunityId: form.opportunityId,
      versionNumber: nextVersion,
      fields: [], // stored compressed in fieldsGz; kept empty inline
      source,
      ...(changeNote ? { changeNote } : {}),
      ...(userId ? { createdBy: userId } : {}),
      ...(userName ? { createdByName: userName } : {}),
      createdAt: nowIso(),
    };

    try {
      await createItem<StoredFormVersion>(
        REQUIRED_FORM_VERSION_PK,
        buildRequiredFormVersionSk(
          form.orgId,
          form.projectId,
          form.opportunityId,
          form.formId,
          nextVersion,
        ),
        {
          ...version,
          [FIELDS_GZ_ATTR]: fieldsGz,
        } as unknown as StoredFormVersion,
      );
      break; // won the slot
    } catch (err) {
      // Someone else took this version number — recompute and retry. Any other
      // error (or exhausting attempts) propagates to the caller.
      if (isConditionalCheckFailed(err) && attempt < SNAPSHOT_MAX_ATTEMPTS - 1) continue;
      throw err;
    }
  }

  // Prune is best-effort maintenance and runs AFTER the version row is committed.
  // It must never mask a successful snapshot: if it threw here, the caller (e.g.
  // revert) would treat a committed snapshot as a failure and abort with a
  // misleading "could not snapshot" message. A skipped prune just leaves the store
  // one row over the cap; the next mutating write prunes it back down.
  await pruneFormVersions(form.orgId, form.projectId, form.opportunityId, form.formId).catch((err) =>
    console.warn('[required-form-version] prune failed (snapshot still committed):', (err as Error)?.message),
  );
  return nextVersion;
};

const pruneFormVersions = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  formId: string,
): Promise<void> => {
  // Key-only read (no compressed payloads); sort newest-first ourselves.
  const numbers = (await listFormVersionNumbers(orgId, projectId, opportunityId, formId)).sort(
    (a, b) => b - a,
  );
  if (numbers.length <= FORM_VERSION_KEEP_COUNT) return;
  const stale = numbers.slice(FORM_VERSION_KEEP_COUNT);
  await batchDeleteItems(
    stale.map((versionNumber) => ({
      pk: REQUIRED_FORM_VERSION_PK,
      sk: buildRequiredFormVersionSk(orgId, projectId, opportunityId, formId, versionNumber),
    })),
  );
};

// ─── Revert ────────────────────────────────────────────────────────────────────

/**
 * Revert a form to a prior version's fields. Snapshots the CURRENT fields first
 * (source SYSTEM) so the revert itself is undoable, then writes the target
 * version's fields back onto the form. Returns the updated form + the snapshot
 * version number that captured the pre-revert state.
 */
export const revertFormToVersion = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  formId: string;
  targetVersion: number;
  userId?: string;
  userName?: string;
  /** Optional user note; appended to the auto "Revert to version N" context. */
  changeNote?: string;
}): Promise<{ form: RequiredFormDBItem; snapshotVersionNumber: number }> => {
  const { orgId, projectId, opportunityId, formId, targetVersion, userId, userName, changeNote } = args;

  const form = await getRequiredForm({ orgId, projectId, opportunityId, formId });
  if (!form) throw new NotFoundError('Form not found');

  const target = await getFormVersion(orgId, projectId, opportunityId, formId, targetVersion);
  if (!target) throw new NotFoundError(`Form version ${targetVersion} not found`);

  // Keep the "which version" context, and append the user's note when supplied
  // (bounded so the combined note can't exceed the schema's 500-char cap).
  const note = changeNote?.trim()
    ? `Revert to version ${targetVersion}: ${changeNote.trim()}`.slice(0, 500)
    : `Revert to version ${targetVersion}`;

  // Snapshot the pre-revert state — REQUIRED, not best-effort. Unlike an ordinary
  // edit (where a lost snapshot only costs undo-history), a revert OVERWRITES the
  // current fields; if the snapshot fails and we proceed, the current state is
  // gone with no way back. So if the snapshot throws, abort the revert entirely
  // and surface the error rather than overwrite. (snapshotFormFields already
  // retries the version-number race internally before it would throw.)
  let snapshotVersionNumber = 0;
  try {
    snapshotVersionNumber = await snapshotFormFields({
      form,
      source: 'SYSTEM',
      userId,
      userName,
      changeNote: note,
    });
  } catch (snapErr) {
    throw new Error(
      `Revert aborted: could not snapshot current form state before overwriting it ` +
        `(${(snapErr as Error)?.message ?? 'unknown error'})`,
    );
  }

  const autoFilled = target.fields.filter((f) => f.status === 'AUTO_FILLED').length;
  const manual = target.fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  const total = target.fields.length;

  const updated = await updateRequiredForm({
    orgId,
    projectId,
    opportunityId,
    formId,
    patch: {
      fields: target.fields,
      autoFillPercentage: total > 0 ? Math.round((autoFilled / total) * 100) : 0,
      manualFieldCount: manual,
      totalFieldCount: total,
    },
  });

  return { form: updated, snapshotVersionNumber };
};
