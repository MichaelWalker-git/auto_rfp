import { z } from 'zod';

export const QuestionFileStatusSchema = z.enum([
  'UPLOADED',
  'PROCESSING',
  'TEXTRACT_RUNNING',
  'TEXT_READY',
  'PROCESSED',
  'FAILED',
  'DELETED',
  'CANCELLED',
]);

export type QuestionFileStatus = z.infer<typeof QuestionFileStatusSchema>;

export const IsoDateStringSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime()) // allow without offset too
  .describe('ISO datetime string');

// UUID validation (relaxed if you sometimes use non-UUID ids)
export const UuidSchema = z.string().uuid();

// ---------- DTOs (API layer) ----------

// What you receive when creating a question file record.
// Usually created after presigned upload is initiated/completed.
export const CreateQuestionFileDTOSchema = z.object({
  projectId: UuidSchema,
  questionFileId: UuidSchema.optional(), // allow server to generate
  fileKey: z.string().min(1).optional(), // S3 key
  fileName: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(), // e.g. application/pdf
  source: z.string().min(1).optional(), // optional: "user-upload", "email", etc.
});

export type CreateQuestionFileDTO = z.infer<typeof CreateQuestionFileDTOSchema>;

// Patch/update. Keep it partial and safe.
export const UpdateQuestionFileDTOSchema = z.object({
  status: QuestionFileStatusSchema.optional(),
  fileKey: z.string().min(1).optional(),
  fileName: z.string().min(1).optional(),
  contentType: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional(),
  // optionally store results metadata
  pages: z.number().int().min(0).optional(),
  extractedQuestionsCount: z.number().int().min(0).optional(),
});

export type UpdateQuestionFileDTO = z.infer<typeof UpdateQuestionFileDTOSchema>;

export const QuestionFileItemSchema = z
  .object({
    orgId: UuidSchema.optional(),
    oppId: UuidSchema.optional(),
    projectId: UuidSchema,
    questionFileId: UuidSchema,
    status: QuestionFileStatusSchema.default('UPLOADED'),
    fileKey: z.string().min(1).optional(),
    originalFileName: z.string().min(1).optional(),
    mimeType: z.string().min(1).optional(),
    source: z.string().min(1).optional(),
    errorMessage: z.string().min(1).optional(),
    pages: z.number().int().min(0).optional(),
    extractedQuestionsCount: z.number().int().min(0).optional(),
    jobId: z.string().optional(),
    totalQuestions: z.number().int().min(0).default(0).optional(),
    taskToken: z.string().optional(),
    createdAt: IsoDateStringSchema,
    updatedAt: IsoDateStringSchema.optional(),
    executionArn: z.string().optional(),
  })
  .passthrough();

export type QuestionFileItem = z.infer<typeof QuestionFileItemSchema>;

export const CreateQuestionFileRequestSchema = z.object({
  projectId: z.string().min(1),
  oppId: z.string(),
  originalFileName: z.string().min(1),
  fileKey: z.string().min(1),
  mimeType: z.string().min(1),
  sourceDocumentId: z.string().optional(),
});

export type CreateQuestionFileRequest = z.infer<typeof CreateQuestionFileRequestSchema>;