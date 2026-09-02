import { z } from 'zod';

// ─── Questionnaire Version ──────────────────────────────────────────────────
//
// A snapshot of a file-based XLSX questionnaire (an RFP document with
// documentType QUESTIONNAIRE, whose content lives only in an .xlsx in S3 —
// there is no HTML and no fields array). Created BEFORE any mutating write (AI
// mass-edit or a revert) so questionnaire edits are revertible, giving
// questionnaires the same history parity RFP documents and required forms have.
//
// Unlike `RequiredFormVersion` (which gzips a fields array into DynamoDB), the
// snapshot payload here is the .xlsx FILE itself — potentially many MB, far over
// the 400 KB item limit — so we store a COPY of the file in S3 and keep only its
// key on the version row (`snapshotFileKey`).
//
// NOTE: ids/timestamps use plain `z.string()` (not `.uuid()`/`.datetime()`) to
// match the sibling version entities' conventions.

export const QuestionnaireVersionSourceSchema = z.enum(['MANUAL', 'AI_MASS_EDIT', 'SYSTEM']);
export type QuestionnaireVersionSource = z.infer<typeof QuestionnaireVersionSourceSchema>;

export const QuestionnaireVersionSchema = z.object({
  versionId: z.string(),
  documentId: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  opportunityId: z.string(),
  versionNumber: z.number().int().min(1),
  // S3 key of the .xlsx as it was BEFORE this version's write.
  snapshotFileKey: z.string(),
  source: QuestionnaireVersionSourceSchema.default('MANUAL'),
  changeNote: z.string().max(500).optional(),
  createdBy: z.string().optional(),
  createdByName: z.string().optional(),
  createdAt: z.string(),
});
export type QuestionnaireVersion = z.infer<typeof QuestionnaireVersionSchema>;

// ─── API Responses ─────────────────────────────────────────────────────────

export const QuestionnaireVersionListResponseSchema = z.object({
  versions: z.array(QuestionnaireVersionSchema),
  count: z.number(),
});
export type QuestionnaireVersionListResponse = z.infer<
  typeof QuestionnaireVersionListResponseSchema
>;

// ─── Revert Request ──────────────────────────────────────────────────────────

export const RevertQuestionnaireVersionRequestSchema = z.object({
  documentId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  targetVersion: z.number().int().min(1),
  changeNote: z.string().max(500).optional(),
});
export type RevertQuestionnaireVersionRequest = z.infer<
  typeof RevertQuestionnaireVersionRequestSchema
>;
