import { z } from 'zod';

/**
 * Extraction Job Schemas
 *
 * Tracks async extraction jobs for batch document uploads.
 * Phase 1: Direct Upload only
 * Phase 2: KB Extraction (to be implemented later)
 */

// ================================
// Status Enums
// ================================

export const ExtractionJobStatusSchema = z.enum([
  'PENDING',      // Job created, waiting to start
  'PROCESSING',   // AI is extracting data
  'COMPLETED',    // Extraction finished, drafts created
  'FAILED',       // Extraction failed
  'CANCELLED',    // User cancelled the job
]);

export type ExtractionJobStatus = z.infer<typeof ExtractionJobStatusSchema>;

export const ExtractionSourceTypeSchema = z.enum([
  'DIRECT_UPLOAD',     // User uploaded files directly
  'KB_EXTRACTION',     // Extracted from Knowledge Base (Phase 2)
]);

export type ExtractionSourceType = z.infer<typeof ExtractionSourceTypeSchema>;

export const ExtractionTargetTypeSchema = z.enum([
  'PAST_PERFORMANCE',
  'LABOR_RATE',
  'BOM_ITEM',
]);

export type ExtractionTargetType = z.infer<typeof ExtractionTargetTypeSchema>;

// Alias for DraftType (same as ExtractionTargetType)
export const DraftTypeSchema = ExtractionTargetTypeSchema;
export type DraftType = ExtractionTargetType;

// ================================
// Source File Schema
// ================================

export const SourceFileStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
]);

export type SourceFileStatus = z.infer<typeof SourceFileStatusSchema>;

export const SourceFileSchema = z.object({
  fileName: z.string(),
  s3Key: z.string(),
  fileSize: z.number().int().positive(),
  status: SourceFileStatusSchema.default('PENDING'),
  error: z.string().optional(),
  draftsCreated: z.number().int().nonnegative().default(0),
});

export type SourceFile = z.infer<typeof SourceFileSchema>;

// ================================
// KB Scan Parameters (Phase 2)
// ================================

export const KBScanParamsSchema = z.object({
  kbIds: z.array(z.string().uuid()).optional(),
  searchQuery: z.string().optional(),
  maxChunks: z.number().int().min(10).max(500).default(100),
});

export type KBScanParams = z.infer<typeof KBScanParamsSchema>;

// ================================
// Error Entry Schema
// ================================

export const ExtractionErrorSchema = z.object({
  source: z.string(),
  error: z.string(),
  timestamp: z.string().datetime(),
});

export type ExtractionError = z.infer<typeof ExtractionErrorSchema>;

// ================================
// Main Extraction Job Schema
// ================================

export const ExtractionJobSchema = z.object({
  jobId: z.string().uuid(),
  orgId: z.string().uuid(),
  sourceType: ExtractionSourceTypeSchema,
  targetType: ExtractionTargetTypeSchema,
  status: ExtractionJobStatusSchema.default('PENDING'),

  // Progress tracking
  totalItems: z.number().int().nonnegative().default(0),
  processedItems: z.number().int().nonnegative().default(0),
  successfulItems: z.number().int().nonnegative().default(0),
  failedItems: z.number().int().nonnegative().default(0),

  // Source files (for direct upload)
  sourceFiles: z.array(SourceFileSchema).default([]),

  // KB scan parameters (Phase 2)
  kbScanParams: KBScanParamsSchema.optional(),

  // Results
  draftsCreated: z.array(z.string().uuid()).default([]),
  errors: z.array(ExtractionErrorSchema).default([]),

  // Timing
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(),
});

export type ExtractionJob = z.infer<typeof ExtractionJobSchema>;

// ================================
// DynamoDB Keys
// ================================

export const EXTRACTION_JOB_PK = 'EXTRACTION_JOB';

export const createExtractionJobSK = (orgId: string, jobId: string): string =>
  `${orgId}#${jobId}`;

export const parseExtractionJobSK = (sk: string): { orgId: string; jobId: string } | null => {
  const parts = sk.split('#');
  if (parts.length !== 2) return null;
  return { orgId: parts[0], jobId: parts[1] };
};

// ================================
// Request/Response DTOs
// ================================

export const CreateExtractionJobDTOSchema = z.object({
  orgId: z.string().uuid(),
  sourceType: ExtractionSourceTypeSchema,
  targetType: ExtractionTargetTypeSchema,
  sourceFiles: z.array(z.object({
    fileName: z.string(),
    s3Key: z.string(),
    fileSize: z.number().int().positive(),
  })).optional(),
  kbScanParams: KBScanParamsSchema.optional(),
});

export type CreateExtractionJobDTO = z.infer<typeof CreateExtractionJobDTOSchema>;

export const GetExtractionJobRequestSchema = z.object({
  orgId: z.string().uuid(),
  jobId: z.string().uuid(),
});

export type GetExtractionJobRequest = z.infer<typeof GetExtractionJobRequestSchema>;

export const ListExtractionJobsRequestSchema = z.object({
  orgId: z.string().uuid(),
  status: ExtractionJobStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  nextToken: z.string().optional(),
});

export type ListExtractionJobsRequest = z.infer<typeof ListExtractionJobsRequestSchema>;

export const GetUploadUrlRequestSchema = z.object({
  orgId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  targetType: ExtractionTargetTypeSchema,
  contentType: z.string().optional(),
});

export type GetUploadUrlRequest = z.infer<typeof GetUploadUrlRequestSchema>;

// ================================
// API Response Types
// ================================

export const ExtractionJobResponseSchema = z.object({
  job: ExtractionJobSchema,
});
export type ExtractionJobResponse = z.infer<typeof ExtractionJobResponseSchema>;

export const ExtractionJobsResponseSchema = z.object({
  jobs: z.array(ExtractionJobSchema),
  nextToken: z.string().optional(),
  total: z.number().int().nonnegative(),
});
export type ExtractionJobsResponse = z.infer<typeof ExtractionJobsResponseSchema>;

export const GetUploadUrlResponseSchema = z.object({
  uploadUrl: z.string().url(),
  s3Key: z.string(),
  expiresIn: z.number().int().positive(),
});
export type GetUploadUrlResponse = z.infer<typeof GetUploadUrlResponseSchema>;

// ================================
// Draft Action Request Schema (for draft-action handler)
// ================================

export const DraftActionRequestSchema = z.object({
  orgId: z.string().uuid(),
  draftId: z.string().uuid(),
  action: z.enum(['confirm', 'discard']),
  draftType: DraftTypeSchema.default('PAST_PERFORMANCE'),
  updates: z.record(z.unknown()).optional(),
});
export type DraftActionRequest = z.infer<typeof DraftActionRequestSchema>;

// ================================
// Labor Rate Draft Schema
// ================================

export const LaborRateDraftStatusSchema = z.enum([
  'DRAFT',
  'CONFIRMED',
  'DISCARDED',
  'EXPIRED',
]);

export type LaborRateDraftStatus = z.infer<typeof LaborRateDraftStatusSchema>;

export const LaborRateDraftSchema = z.object({
  draftId: z.string().uuid(),
  orgId: z.string().uuid(),
  draftStatus: LaborRateDraftStatusSchema.default('DRAFT'),
  targetType: z.literal('LABOR_RATE'),
  
  // Labor rate fields
  position: z.string(),
  baseRate: z.number().nonnegative(),
  overhead: z.number().nonnegative().default(0),
  ga: z.number().nonnegative().default(0),
  profit: z.number().nonnegative().default(0),
  fullyLoadedRate: z.number().nonnegative(),
  effectiveDate: z.string().optional(),
  expirationDate: z.string().optional(),
  rateSource: z.string().optional(),
  
  // Extraction metadata
  extractionSource: z.object({
    sourceType: z.enum(['DIRECT_UPLOAD', 'KB_EXTRACTION']),
    sourceDocumentKey: z.string().optional(),
    sourceDocumentName: z.string().optional(),
    extractionJobId: z.string().uuid().optional(),
    extractedAt: z.string().datetime(),
    extractedBy: z.string().uuid(),
  }).optional(),
  
  fieldConfidence: z.object({
    position: z.number().min(0).max(100).optional(),
    baseRate: z.number().min(0).max(100).optional(),
    overall: z.number().min(0).max(100),
  }).optional(),
  
  // Duplicate warning - set when a labor rate with same position already exists
  duplicateWarning: z.object({
    isDuplicate: z.boolean(),
    existingPosition: z.string().optional(),
    existingBaseRate: z.number().optional(),
    existingFullyLoadedRate: z.number().optional(),
  }).optional(),
  
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
});

export type LaborRateDraft = z.infer<typeof LaborRateDraftSchema>;

// ================================
// BOM Item Draft Schema
// ================================

export const BOMItemDraftStatusSchema = z.enum([
  'DRAFT',
  'CONFIRMED',
  'DISCARDED',
  'EXPIRED',
]);

export type BOMItemDraftStatus = z.infer<typeof BOMItemDraftStatusSchema>;

export const BOMItemDraftSchema = z.object({
  draftId: z.string().uuid(),
  orgId: z.string().uuid(),
  draftStatus: BOMItemDraftStatusSchema.default('DRAFT'),
  targetType: z.literal('BOM_ITEM'),
  
  // BOM item fields
  name: z.string(),
  description: z.string().optional(),
  category: z.string(), // Category string (flexible for different BOM categories)
  unitCost: z.number().nonnegative(),
  unit: z.string().default('each'),
  vendor: z.string().optional(),
  partNumber: z.string().optional(),
  quantity: z.number().int().positive().optional(),
  
  // Extraction metadata
  extractionSource: z.object({
    sourceType: z.enum(['DIRECT_UPLOAD', 'KB_EXTRACTION']),
    sourceDocumentKey: z.string().optional(),
    sourceDocumentName: z.string().optional(),
    extractionJobId: z.string().uuid().optional(),
    extractedAt: z.string().datetime(),
    extractedBy: z.string(),
  }).optional(),
  
  fieldConfidence: z.object({
    name: z.number().min(0).max(100).optional(),
    unitCost: z.number().min(0).max(100).optional(),
    category: z.number().min(0).max(100).optional(),
    overall: z.number().min(0).max(100),
  }).optional(),
  
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime().optional(),
  // Confirmation tracking
  confirmedBy: z.string().optional(),
  confirmedAt: z.string().datetime().optional(),
  confirmedBOMItemId: z.string().uuid().optional(),
});

export type BOMItemDraft = z.infer<typeof BOMItemDraftSchema>;

// ================================
// Draft DynamoDB Keys
// ================================

export const DRAFT_LABOR_RATE_PK = 'DRAFT_LABOR_RATE';
export const DRAFT_BOM_ITEM_PK = 'DRAFT_BOM_ITEM';

export const createDraftLaborRateSK = (orgId: string, draftId: string): string =>
  `${orgId}#${draftId}`;

export const createDraftBOMItemSK = (orgId: string, draftId: string): string =>
  `${orgId}#${draftId}`;

// ================================
// Draft Response Types
// ================================

export interface LaborRateDraftsResponse {
  drafts: LaborRateDraft[];
  total: number;
  nextToken?: string;
}

export interface BOMItemDraftsResponse {
  drafts: BOMItemDraft[];
  total: number;
  nextToken?: string;
}

// Union type for all drafts
export type ExtractionDraft = LaborRateDraft | BOMItemDraft;
