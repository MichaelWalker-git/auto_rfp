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
    fileSize: z.number().int().min(0).optional(),  // file size in bytes
    jobId: z.string().optional(),
    totalQuestions: z.number().int().min(0).default(0).optional(),
    taskToken: z.string().optional(),
    createdAt: IsoDateStringSchema,
    updatedAt: IsoDateStringSchema.optional(),
    executionArn: z.string().optional(),

    // Google Drive integration
    googleDriveFileId: z.string().optional(),
    googleDriveUrl: z.string().url().optional(),
    googleDriveFolderId: z.string().optional(),
    googleDriveUploadedAt: IsoDateStringSchema.optional(),
  })
  .passthrough();

export type QuestionFileItem = z.infer<typeof QuestionFileItemSchema>;

export const CreateQuestionFileRequestSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1),
  oppId: z.string().min(1),
  originalFileName: z.string().min(1),
  fileKey: z.string().min(1),
  mimeType: z.string().min(1),
  sourceDocumentId: z.string().optional(),
  fileSize: z.number().int().min(0).optional(),  // file size in bytes
});

export type CreateQuestionFileRequest = z.infer<typeof CreateQuestionFileRequestSchema>;

export const ReextractQuestionsSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  oppId: z.string().min(1, 'oppId is required'),
  questionFileId: z.string().min(1, 'questionFileId is required'),
});

export type ReextractQuestions = z.infer<typeof ReextractQuestionsSchema>;

export const ReextractAllQuestionsSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  oppId: z.string().min(1, 'oppId is required'),
});

export type ReextractAllQuestions = z.infer<typeof ReextractAllQuestionsSchema>;

export const StartQuestionPipelineSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  oppId: z.string().min(1, 'oppId is required'),
  questionFileId: z.string().min(1, 'questionFileId is required'),
});

export type StartQuestionPipeline = z.infer<typeof StartQuestionPipelineSchema>;

export const StopQuestionPipelineSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
  questionFileId: z.string().min(1, 'questionFileId is required'),
});

export type StopQuestionPipeline = z.infer<typeof StopQuestionPipelineSchema>;
