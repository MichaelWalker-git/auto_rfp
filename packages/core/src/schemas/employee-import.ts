import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';
import { EmployeeLocationSchema } from './employee';

/**
 * Employee CV import (team-definition U2).
 *
 * EmployeeImportRun — one execution of the generate-from-CVs flow for an org:
 * progress counters plus a named failure list (BR4.1). Runs are append-only
 * history; at most one RUNNING run per org (BR1.1).
 *
 * EmployeeExtractionSnapshot — the values the most recent extraction wrote for
 * one employee. Comparing current Employee values against it makes manual
 * edits win on re-import (BR3.3) without touching U1's Employee schema.
 */

/* ── Failure records ────────────────────────────────────── */

/**
 * Why a document produced no employee: UNREADABLE / INCOMPLETE_EXTRACTION are
 * the user-facing categories (Q2); EXTRACTION_FAILED / AMBIGUOUS_NAME are
 * operational (BR2.1, BR3.1). UNMATCHED_PERSON is a personal-certification
 * document whose holder is not in the employee pool.
 */
export const ImportFailureReasonSchema = z.enum([
  'UNREADABLE',
  'INCOMPLETE_EXTRACTION',
  'EXTRACTION_FAILED',
  'AMBIGUOUS_NAME',
  'UNMATCHED_PERSON',
]);
export type ImportFailureReason = z.infer<typeof ImportFailureReasonSchema>;

/** One failed document in the run report — named, with its category (BR4.1). */
export const ImportFailedDocumentSchema = z.object({
  documentName: z
    .string()
    .trim()
    .min(1, 'documentName is required')
    .max(500, 'documentName cannot exceed 500 characters'),
  reason: ImportFailureReasonSchema,
});
export type ImportFailedDocument = z.infer<typeof ImportFailedDocumentSchema>;

/* ── EmployeeImportRun ──────────────────────────────────── */

export const EmployeeImportRunStatusSchema = z.enum([
  'RUNNING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
]);
export type EmployeeImportRunStatus = z.infer<typeof EmployeeImportRunStatusSchema>;

/**
 * Pure domain entity returned by the API — NO DynamoDB keys. Import runs are
 * created only by the trigger flow (no client-supplied create/update request
 * shapes; the run record is server-managed and append-only).
 */
export const EmployeeImportRunItemSchema = z.object({
  importRunId: z.string().min(1),
  orgId: z.string().min(1),
  status: EmployeeImportRunStatusSchema.default('RUNNING'),
  documentsScanned: z.number().int().nonnegative().default(0),
  cvsDetected: z.number().int().nonnegative().default(0),
  employeesCreated: z.number().int().nonnegative().default(0),
  employeesUpdated: z.number().int().nonnegative().default(0),
  /** Personal-certification documents detected (defaults keep pre-existing run records parseable). */
  certificationDocsDetected: z.number().int().nonnegative().default(0),
  /** Individual certifications appended to employees from certification documents. */
  certificationsMapped: z.number().int().nonnegative().default(0),
  failedDocuments: z.array(ImportFailedDocumentSchema).default([]),
  /** The requesting user (must hold employee:manage — BR1.2). */
  triggeredBy: z.string().min(1),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type EmployeeImportRunItem = z.infer<typeof EmployeeImportRunItemSchema>;

/** DynamoDB record — domain entity plus single-table keys. */
export const EmployeeImportRunDBItemSchema = EmployeeImportRunItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type EmployeeImportRunDBItem = z.infer<typeof EmployeeImportRunDBItemSchema>;

/** Lightweight projection for progress banners / run history views. */
export const EmployeeImportRunListItemSchema = z.object({
  importRunId: z.string(),
  orgId: z.string(),
  status: EmployeeImportRunStatusSchema,
  documentsScanned: z.number().int().nonnegative(),
  cvsDetected: z.number().int().nonnegative(),
  employeesCreated: z.number().int().nonnegative(),
  employeesUpdated: z.number().int().nonnegative(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
});
export type EmployeeImportRunListItem = z.infer<typeof EmployeeImportRunListItemSchema>;

/* ── EmployeeExtractionSnapshot ─────────────────────────── */

/**
 * The Employee field values the extraction populates (entities.md: name,
 * primaryRoles, secondaryRoles, certifications, resumeRef, location). All
 * optional — a CV may state only some of them.
 */
export const EmployeeExtractionFieldsSchema = z.object({
  name: z.string().optional(),
  primaryRoles: z.array(z.string()).optional(),
  secondaryRoles: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  resumeRef: z.string().optional(),
  location: EmployeeLocationSchema.optional(),
});
export type EmployeeExtractionFields = z.infer<typeof EmployeeExtractionFieldsSchema>;

/**
 * Pure domain entity — one snapshot per employee touched by an import.
 * Written only by the import flow; never edited by hand.
 */
export const EmployeeExtractionSnapshotItemSchema = z.object({
  employeeId: z.string().min(1),
  orgId: z.string().min(1),
  fields: EmployeeExtractionFieldsSchema,
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type EmployeeExtractionSnapshotItem = z.infer<typeof EmployeeExtractionSnapshotItemSchema>;

/** DynamoDB record — snapshot plus single-table keys. */
export const EmployeeExtractionSnapshotDBItemSchema = EmployeeExtractionSnapshotItemSchema.extend({
  [PK_NAME]: z.string(),
  [SK_NAME]: z.string(),
});
export type EmployeeExtractionSnapshotDBItem = z.infer<
  typeof EmployeeExtractionSnapshotDBItemSchema
>;

/* ── API response shapes (for frontend hooks) ──────────── */

/** GET /employee/import/latest — null when the org has never run an import. */
export const EmployeeImportRunResponseSchema = z.object({
  run: EmployeeImportRunItemSchema.nullable(),
});
export type EmployeeImportRunResponse = z.infer<typeof EmployeeImportRunResponseSchema>;

/** POST /employee/import/trigger — the newly created run. */
export const TriggerEmployeeImportResponseSchema = z.object({
  run: EmployeeImportRunItemSchema,
});
export type TriggerEmployeeImportResponse = z.infer<typeof TriggerEmployeeImportResponseSchema>;
