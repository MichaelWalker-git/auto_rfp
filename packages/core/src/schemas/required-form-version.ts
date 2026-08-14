import { z } from 'zod';

import { DetectedFormFieldSchema } from './required-form';

// ─── Required Form Version ─────────────────────────────────────────────────────

/**
 * A snapshot of a required form's fields at a point in time. Created BEFORE any
 * mutating write (AI mass-edit, AI fill, or manual field save) so form edits are
 * revertible. Forms had NO history before this; RFP documents already auto-version
 * (see `rfp-document-version.ts`, which this mirrors).
 *
 * The snapshot payload is the full `fields` array as it was BEFORE this version's
 * write. It is stored gzip-compressed in DynamoDB (same trick as `required-form.ts`
 * `fieldsGz`) because large XLSX matrices produce field arrays that overflow the
 * 400 KB item limit.
 *
 * NOTE: ids/timestamps use plain `z.string()` (not `.uuid()`/`.datetime()`) to match
 * the `required-form.ts` conventions this entity is a sibling of.
 */
export const RequiredFormVersionSourceSchema = z.enum([
  'MANUAL',
  'AI_MASS_EDIT',
  'AI_FILL',
  'SYSTEM',
]);
export type RequiredFormVersionSource = z.infer<typeof RequiredFormVersionSourceSchema>;

export const RequiredFormVersionSchema = z.object({
  versionId: z.string(),
  formId: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  versionNumber: z.number().int().min(1),
  // The snapshot: the fields array as it was BEFORE this version's write.
  fields: z.array(DetectedFormFieldSchema),
  source: RequiredFormVersionSourceSchema.default('MANUAL'),
  changeNote: z.string().max(500).optional(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
  createdAt: z.string(),
});

export type RequiredFormVersion = z.infer<typeof RequiredFormVersionSchema>;

// ─── API Responses ─────────────────────────────────────────────────────────────

export const RequiredFormVersionListResponseSchema = z.object({
  versions: z.array(RequiredFormVersionSchema),
  count: z.number(),
});
export type RequiredFormVersionListResponse = z.infer<
  typeof RequiredFormVersionListResponseSchema
>;

// ─── Revert Request ──────────────────────────────────────────────────────────

export const RevertFormVersionRequestSchema = z.object({
  formId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  targetVersion: z.number().int().min(1),
  changeNote: z.string().max(500).optional(),
});
export type RevertFormVersionRequest = z.infer<typeof RevertFormVersionRequestSchema>;
