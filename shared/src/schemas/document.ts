import { z } from 'zod';

export const DocumentIndexStatusSchema = z.enum([
  'CHUNKED',
  'processing',
  'INDEXED',
  'FAILED',
  'ready',
]);

export type IndexStatus = z.infer<typeof DocumentIndexStatusSchema>

export const DocumentSchema = z.object({
  id: z.string(),
  name: z.string(),
  fileKey: z.string(),
  indexStatus: DocumentIndexStatusSchema,
  createdAt: z.string(), // ISO string
});

export type KbDocument = z.infer<typeof DocumentSchema>;

export const UploadResultSchema = z.object({
  fileKey: z.string(),
  fileId: z.string(),
  sortKey: z.string(),
  fileName: z.string(),
});

export const DocumentItemSchema = z.object({
  id: z.string(),                     // uuid
  knowledgeBaseId: z.string(),        // belongs to KB
  name: z.string(),
  fileKey: z.string(),                // original PDF
  textFileKey: z.string(),            // extracted text
  indexStatus: DocumentIndexStatusSchema,
  indexVectorKey: z.string().optional(), // embeddings file maybe
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().optional(),   // userId of the uploader
  updatedBy: z.string().optional(),   // userId of last updater
});

export type DocumentItem = z.infer<typeof DocumentItemSchema>;

//
// ================================
// DTOs (API Input)
// ================================
//

export const CreateDocumentDTOSchema = z.object({
  knowledgeBaseId: z.string(),
  name: z.string(),
  fileKey: z.string(),
  textFileKey: z.string()
});

export type CreateDocumentDTO = z.infer<typeof CreateDocumentDTOSchema>;

export const UpdateDocumentDTOSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
});

export type UpdateDocumentDTO = z.infer<typeof UpdateDocumentDTOSchema>;

export const DeleteDocumentDTOSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string(),
  orgId: z.string(),
});

export type DeleteDocumentDTO = z.infer<typeof DeleteDocumentDTOSchema>;
