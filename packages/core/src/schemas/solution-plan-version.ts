/**
 * solution-plan-version.ts
 *
 * Solution Plan version history (contract C3, solution-plan-versioning u1).
 * One immutable record per content-producing plan write — generation
 * completion, manual content save, or restore (BR1.1–BR1.3). Team-only writes
 * never create a version (BR1.4). The HTML body lives in S3 under the
 * version's OWN `htmlContentKey` (never shared between versions, BR2.1);
 * DynamoDB holds only the metadata record. At most 30 versions per plan
 * (BR4.1); the only attribute mutable after creation is `label`.
 */

import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';
import { SolutionPlanCostScheduleSchema, SolutionPlanKeySchema } from './solution-plan';

// ─── System attribution sentinel (BR3.3, pinned NFR design decision) ───────────

/**
 * Canonical sentinel written to `createdBy` when a generated version has no
 * initiator stamp (e.g. generation started before this feature deployed).
 * Every unit imports these constants — u1 writes them, u2 lists them, u4
 * displays them. NEVER re-type the literals.
 */
export const SYSTEM_CREATED_BY = 'SYSTEM';

/** Display-name counterpart of {@link SYSTEM_CREATED_BY}. */
export const SYSTEM_CREATED_BY_NAME = 'System';

// ─── Origin ─────────────────────────────────────────────────────────────────────

/**
 * Which write produced the version (BR2.3 — closed enum; adding a value is a
 * breaking change for the UI's origin rendering, per C3's evolution rules).
 */
export const SolutionPlanVersionOriginSchema = z.enum(['generation', 'manual-save', 'restore']);

export type SolutionPlanVersionOrigin = z.infer<typeof SolutionPlanVersionOriginSchema>;

/** The single mutable attribute — optional user label, max 100 chars. */
export const SolutionPlanVersionLabelSchema = z.string().max(100);

// ─── 1. Create request ──────────────────────────────────────────────────────────

/**
 * Capture payload recorded by the version-capture helper. Server-managed
 * fields (`versionId`, `createdAt`) are omitted; `label` is never set at
 * creation. `versionNumber` is the plan's internal counter value AFTER the
 * triggering write's bump (BR2.2) — unique per plan, display gaps expected
 * (team-only bumps create no version).
 */
export const SolutionPlanVersionCreateRequestSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  solutionPlanId: z.string().min(1),
  versionNumber: z.number().int().min(1),
  /** S3 key of THIS version's own body — never shared between versions (BR2.1). */
  htmlContentKey: z.string().min(1),
  /** The plan's cost schedule as of the captured write; absent when that write cleared it. */
  costScheduleSnapshot: SolutionPlanCostScheduleSchema.nullish(),
  origin: SolutionPlanVersionOriginSchema,
  /** User id, or {@link SYSTEM_CREATED_BY} when attribution is unavailable (BR3.3). */
  createdBy: z.string().min(1),
  /** Display name matching `createdBy`. */
  createdByName: z.string().min(1),
});

export type SolutionPlanVersionCreateRequest = z.infer<
  typeof SolutionPlanVersionCreateRequestSchema
>;

// ─── 2. Update request ──────────────────────────────────────────────────────────

/**
 * PATCH body — the label is the ONLY mutable attribute. Empty/whitespace (or
 * null) clears it; identifiers travel separately in the route payload.
 */
export const SolutionPlanVersionUpdateRequestSchema = z.object({
  label: SolutionPlanVersionLabelSchema.nullish(),
});

export type SolutionPlanVersionUpdateRequest = z.infer<
  typeof SolutionPlanVersionUpdateRequestSchema
>;

// ─── 3. Item (pure domain entity) ───────────────────────────────────────────────

/** Version domain entity returned by the API — no DynamoDB keys. */
export const SolutionPlanVersionItemSchema = SolutionPlanVersionCreateRequestSchema.extend({
  versionId: z.string().min(1),
  label: SolutionPlanVersionLabelSchema.nullish(),
  createdAt: z.string(),
});

export type SolutionPlanVersionItem = z.infer<typeof SolutionPlanVersionItemSchema>;

// ─── 4. DB record (domain entity + single-table keys) ───────────────────────────

export const SolutionPlanVersionDBItemSchema = SolutionPlanVersionItemSchema.extend({
  [PK_NAME]: z.string(), // Partition Key (SOLUTION_PLAN_VERSION_PK)
  [SK_NAME]: z.string(), // Sort Key (`${orgId}#${projectId}#${opportunityId}#${versionNumber:6pad}`)
});

export type SolutionPlanVersionDBItem = z.infer<typeof SolutionPlanVersionDBItemSchema>;

// ─── 5. Lightweight list shape ──────────────────────────────────────────────────

/** Projection the version-history list renders (contract C1 list item). */
export const SolutionPlanVersionListItemSchema = z.object({
  versionId: z.string(),
  versionNumber: z.number().int(),
  origin: SolutionPlanVersionOriginSchema,
  label: SolutionPlanVersionLabelSchema.nullish(),
  createdBy: z.string(),
  createdByName: z.string(),
  createdAt: z.string(),
});

export type SolutionPlanVersionListItem = z.infer<typeof SolutionPlanVersionListItemSchema>;

// ─── Endpoint request schemas (contract C1, u2-version-history-api) ─────────────

/** Query of GET /solution-plan/versions — the plan's identifier triple (BR4.1). */
export const SolutionPlanVersionListRequestSchema = SolutionPlanKeySchema;

export type SolutionPlanVersionListRequest = z.infer<typeof SolutionPlanVersionListRequestSchema>;

/** Query of GET /solution-plan/version/content — key triple + versionId. */
export const SolutionPlanVersionContentRequestSchema = SolutionPlanKeySchema.extend({
  versionId: z.string().min(1),
});

export type SolutionPlanVersionContentRequest = z.infer<
  typeof SolutionPlanVersionContentRequestSchema
>;

/**
 * Body of PATCH /solution-plan/version/label. A label longer than 100 chars is
 * a 400 (BR2.1); an absent/null/empty/whitespace label CLEARS it (BR2.2).
 */
export const SolutionPlanVersionLabelRequestSchema = SolutionPlanKeySchema.extend({
  versionId: z.string().min(1),
  label: SolutionPlanVersionLabelSchema.nullish(),
});

export type SolutionPlanVersionLabelRequest = z.infer<
  typeof SolutionPlanVersionLabelRequestSchema
>;

/** Query of DELETE /solution-plan/version — key triple + versionId. */
export const SolutionPlanVersionDeleteRequestSchema = SolutionPlanVersionContentRequestSchema;

export type SolutionPlanVersionDeleteRequest = z.infer<
  typeof SolutionPlanVersionDeleteRequestSchema
>;

/**
 * Body of POST /solution-plan/version/restore (contract C2, u3) — key triple +
 * the SOURCE versionId to restore. Identifiers only: attribution is derived
 * server-side from the authenticated caller (NFR3.12) and no client string
 * ever becomes a storage key (NFR3.11), so the schema deliberately carries no
 * attribution or content fields.
 */
export const SolutionPlanVersionRestoreRequestSchema = SolutionPlanKeySchema.extend({
  versionId: z.string().min(1),
});

export type SolutionPlanVersionRestoreRequest = z.infer<
  typeof SolutionPlanVersionRestoreRequestSchema
>;

// ─── API response schemas (contract C1 envelopes) ───────────────────────────────

/**
 * 200 body of GET /solution-plan/versions. `currentVersionId` is the NEWEST
 * history record's versionId derived from the same query result — never the
 * plan's internal counter (BR1.1); null when the history is empty.
 */
export const SolutionPlanVersionListResponseSchema = z.object({
  ok: z.boolean(),
  versions: z.array(SolutionPlanVersionListItemSchema),
  currentVersionId: z.string().nullable(),
});

export type SolutionPlanVersionListResponse = z.infer<
  typeof SolutionPlanVersionListResponseSchema
>;

/** 200 body of GET /solution-plan/version/content — body + version metadata. */
export const SolutionPlanVersionContentResponseSchema = z.object({
  ok: z.boolean(),
  html: z.string(),
  version: SolutionPlanVersionListItemSchema,
});

export type SolutionPlanVersionContentResponse = z.infer<
  typeof SolutionPlanVersionContentResponseSchema
>;

/** 200 body of PATCH /solution-plan/version/label — the updated list item. */
export const SolutionPlanVersionLabelResponseSchema = z.object({
  ok: z.boolean(),
  version: SolutionPlanVersionListItemSchema,
});

export type SolutionPlanVersionLabelResponse = z.infer<
  typeof SolutionPlanVersionLabelResponseSchema
>;

/** 200 body of DELETE /solution-plan/version. */
export const SolutionPlanVersionDeleteResponseSchema = z.object({
  ok: z.boolean(),
  versionId: z.string(),
});

export type SolutionPlanVersionDeleteResponse = z.infer<
  typeof SolutionPlanVersionDeleteResponseSchema
>;

/**
 * 200 body of POST /solution-plan/version/restore (contract C2). `newVersion`
 * is the restore's own captured history row — null when the capture failed
 * fail-open (the plan is still fully restored; u1's BR5.1).
 */
export const SolutionPlanVersionRestoreResponseSchema = z.object({
  ok: z.boolean(),
  newVersion: SolutionPlanVersionListItemSchema.nullable(),
});

export type SolutionPlanVersionRestoreResponse = z.infer<
  typeof SolutionPlanVersionRestoreResponseSchema
>;
