import { v4 as uuidv4 } from 'uuid';

import { createItem, getItem, putItem, queryBySkPrefix, updateItem } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import {
  EMPLOYEE_EXTRACTION_SNAPSHOT_PK,
  EMPLOYEE_IMPORT_RUN_PK,
} from '@/constants/employee-import';
import { PK_NAME, SK_NAME } from '@/constants/common';

import type {
  EmployeeExtractionFields,
  EmployeeExtractionSnapshotDBItem,
  EmployeeExtractionSnapshotItem,
  EmployeeImportRunDBItem,
  EmployeeImportRunItem,
  EmployeeImportRunStatus,
  ImportFailedDocument,
} from '@auto-rfp/core';

/* ── SK builders (never construct these strings manually) ─ */

/** Sort key for an import run: `{orgId}#{importRunId}` (org-scoped, BR1.1). */
export const buildImportRunSk = (orgId: string, importRunId: string): string =>
  `${orgId}#${importRunId}`;

/** SK prefix that scopes an import-run query to one organization. */
export const buildImportRunSkPrefix = (orgId: string): string => `${orgId}#`;

/** Sort key for an extraction snapshot: `{orgId}#{employeeId}` (one per employee). */
export const buildExtractionSnapshotSk = (orgId: string, employeeId: string): string =>
  `${orgId}#${employeeId}`;

/* ── Mappers ────────────────────────────────────────────── */

/** Strip DynamoDB keys, returning the pure domain entity for API responses. */
export const toImportRunItem = (dbItem: EmployeeImportRunDBItem): EmployeeImportRunItem => {
  const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...item } = dbItem;
  return item;
};

/* ── Errors ─────────────────────────────────────────────── */

/**
 * BR1.1 — thrown when a trigger arrives while a run is already RUNNING for the
 * org. Carries the running run so the handler can point the caller at it.
 */
export class ImportRunAlreadyRunningError extends Error {
  readonly runningRun: EmployeeImportRunItem;

  constructor(runningRun: EmployeeImportRunItem) {
    super(`An employee import is already running for org ${runningRun.orgId}`);
    this.name = 'ImportRunAlreadyRunningError';
    this.runningRun = runningRun;
  }
}

/* ── Import run lifecycle ───────────────────────────────── */

/**
 * CREATE — start a new RUNNING import run (BR1.1: refuses when a run is
 * already RUNNING for the org by throwing ImportRunAlreadyRunningError).
 */
export const createImportRun = async (
  orgId: string,
  triggeredBy: string,
): Promise<EmployeeImportRunItem> => {
  const latest = await getLatestImportRun(orgId);
  if (latest?.status === 'RUNNING') {
    throw new ImportRunAlreadyRunningError(latest);
  }

  const importRunId = uuidv4();
  const dbItem = await createItem<EmployeeImportRunDBItem>(
    EMPLOYEE_IMPORT_RUN_PK,
    buildImportRunSk(orgId, importRunId),
    {
      importRunId,
      orgId,
      status: 'RUNNING',
      documentsScanned: 0,
      cvsDetected: 0,
      employeesCreated: 0,
      employeesUpdated: 0,
      failedDocuments: [],
      triggeredBy,
      startedAt: nowIso(),
    },
  );

  return toImportRunItem(dbItem);
};

/** READ — one run within the org scope. */
export const getImportRun = async (
  orgId: string,
  importRunId: string,
): Promise<EmployeeImportRunItem | null> => {
  const dbItem = await getItem<EmployeeImportRunDBItem>(
    EMPLOYEE_IMPORT_RUN_PK,
    buildImportRunSk(orgId, importRunId),
  );
  return dbItem ? toImportRunItem(dbItem) : null;
};

/**
 * READ — the most recent run for the org (by startedAt), or null when the org
 * has never imported. Run history is small (append-only, one per trigger), so
 * the org-prefix query plus in-memory sort is sufficient.
 */
export const getLatestImportRun = async (
  orgId: string,
): Promise<EmployeeImportRunItem | null> => {
  const dbItems = await queryBySkPrefix<EmployeeImportRunDBItem>(
    EMPLOYEE_IMPORT_RUN_PK,
    buildImportRunSkPrefix(orgId),
  );
  if (dbItems.length === 0) return null;

  const latest = [...dbItems].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return toImportRunItem(latest);
};

/** Counter/failure fields the engine advances as documents process (BR5.1). */
export type ImportRunProgressPatch = Partial<{
  documentsScanned: number;
  cvsDetected: number;
  employeesCreated: number;
  employeesUpdated: number;
  failedDocuments: ImportFailedDocument[];
}>;

/** UPDATE — advance progress counters while the run is RUNNING (BR5.1). */
export const updateImportRunProgress = async (
  orgId: string,
  importRunId: string,
  patch: ImportRunProgressPatch,
): Promise<EmployeeImportRunItem> => {
  const dbItem = await updateItem<EmployeeImportRunDBItem>(
    EMPLOYEE_IMPORT_RUN_PK,
    buildImportRunSk(orgId, importRunId),
    patch,
  );
  return toImportRunItem(dbItem);
};

/**
 * UPDATE — close the run in a terminal state with its final counts and named
 * failure list (BR4.1); FAILED preserves partial counts (BR4.2).
 */
export const completeImportRun = async (
  orgId: string,
  importRunId: string,
  outcome: {
    status: Exclude<EmployeeImportRunStatus, 'RUNNING'>;
  } & ImportRunProgressPatch,
): Promise<EmployeeImportRunItem> => {
  const dbItem = await updateItem<EmployeeImportRunDBItem>(
    EMPLOYEE_IMPORT_RUN_PK,
    buildImportRunSk(orgId, importRunId),
    { ...outcome, completedAt: nowIso() },
  );
  return toImportRunItem(dbItem);
};

/* ── Extraction snapshots (BR3.3 manual-edits-win basis) ── */

/** READ — the last extracted values for an employee, or null (e.g. manually created). */
export const getExtractionSnapshot = async (
  orgId: string,
  employeeId: string,
): Promise<EmployeeExtractionSnapshotItem | null> => {
  const dbItem = await getItem<EmployeeExtractionSnapshotDBItem>(
    EMPLOYEE_EXTRACTION_SNAPSHOT_PK,
    buildExtractionSnapshotSk(orgId, employeeId),
  );
  if (!dbItem) return null;
  const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...item } = dbItem;
  return item;
};

/**
 * UPSERT — refresh the snapshot with the newly extracted values. Written only
 * by the import flow; every merge refreshes it in full (BR3.3).
 */
export const putExtractionSnapshot = async (
  orgId: string,
  employeeId: string,
  fields: EmployeeExtractionFields,
): Promise<EmployeeExtractionSnapshotItem> => {
  const dbItem = await putItem<EmployeeExtractionSnapshotDBItem>(
    EMPLOYEE_EXTRACTION_SNAPSHOT_PK,
    buildExtractionSnapshotSk(orgId, employeeId),
    { employeeId, orgId, fields },
  );
  const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...item } = dbItem;
  return item;
};
