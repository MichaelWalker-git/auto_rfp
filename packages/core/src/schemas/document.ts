import { z } from 'zod';

export const DocumentItemSchema = z.object({
  id: z.string(),                     // uuid
  knowledgeBaseId: z.string(),        // belongs to this KB
  name: z.string(),
  fileKey: z.string(),                // original PDF / uploaded file
  textFileKey: z.string(),            // extracted text file in S3

  indexStatus: z.enum(['pending', 'TEXT_EXTRACTED', 'TEXT_EXTRACTION_FAILED', 'CHUNKED', 'INDEXED', 'ready', 'failed']),
  indexVectorKey: z.string().optional(), // embeddings file or vector DB key

  taskToken: z.string().optional().nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().optional(),   // user who created the document
  
  // Freshness tracking fields
  freshnessStatus: z.enum(['ACTIVE', 'WARNING', 'STALE', 'ARCHIVED']).optional(),
  staleReason: z.string().optional(),
  staleSince: z.string().optional(),
  lastUsedAt: z.string().optional(),
});

export type DocumentItem = z.infer<typeof DocumentItemSchema>;

export const CreateDocumentDTOSchema = z.object({
  knowledgeBaseId: z.string(),
  name: z.string(),
  fileKey: z.string(),
  textFileKey: z.string()
});

export type CreateDocumentDTO = z.infer<typeof CreateDocumentDTOSchema>;

export const UpdateDocumentDTOSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string(),  // required for locating the SK
  name: z.string().optional(),
  indexStatus: z.enum(['pending', 'TEXT_EXTRACTED', 'TEXT_EXTRACTION_FAILED', 'CHUNKED', 'INDEXED', 'ready', 'failed']).optional(),
  indexVectorKey: z.string().optional(),
});

export type UpdateDocumentDTO = z.infer<typeof UpdateDocumentDTOSchema>;

export const DeleteDocumentDTOSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  knowledgeBaseId: z.string(),
});

export type DeleteDocumentDTO = z.infer<typeof DeleteDocumentDTOSchema>;

// Index Document Schemas
export const IndexDocumentDTOSchema = z.object({
  documentId: z.string(),
  knowledgeBaseId: z.string(),
});

export type IndexDocumentDTO = z.infer<typeof IndexDocumentDTOSchema>;

export const IndexDocumentResponseSchema = z.object({
  status: z.enum(['queued', 'started', 'completed', 'error']),
  message: z.string().optional(),
});

export type IndexDocumentResponse = z.infer<typeof IndexDocumentResponseSchema>;

// Start Document Pipeline Schemas
export const StartDocumentPipelineDTOSchema = z.object({
  orgId: z.string().optional(),
  documentId: z.string(),
  knowledgeBaseId: z.string(),
});

export type StartDocumentPipelineDTO = z.infer<typeof StartDocumentPipelineDTOSchema>;

export const StartDocumentPipelineResponseSchema = z.object({
  executionArn: z.string(),
  startDate: z.string(),
  message: z.string().optional(),
});

export type StartDocumentPipelineResponse = z.infer<typeof StartDocumentPipelineResponseSchema>;

// Download Document Schemas
export const DownloadDocumentResponseSchema = z.object({
  url: z.string(),
  method: z.string(),
  fileName: z.string(),
  expiresIn: z.number(),
});

export type DownloadDocumentResponse = z.infer<typeof DownloadDocumentResponseSchema>;

// Upload Result Schema
export const UploadResultSchema = z.object({
  fileKey: z.string(),
  fileId: z.string(),
  sortKey: z.string(),
  fileName: z.string(),
});

export type UploadResult = z.infer<typeof UploadResultSchema>;
