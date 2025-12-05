import { z } from 'zod';

//
// ================================
// DOCUMENT SCHEMA (DB Item)
// ================================
//

export const DocumentItemSchema = z.object({
  id: z.string(),                     // uuid
  knowledgeBaseId: z.string(),        // belongs to KB
  name: z.string(),
  fileKey: z.string(),                // original PDF
  textFileKey: z.string(),            // extracted text
  indexStatus: z.enum(["pending", "processing", "ready", "failed"]),
  indexVectorKey: z.string().optional(), // embeddings file maybe
  createdAt: z.string(),
  updatedAt: z.string(),
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
});

export type DeleteDocumentDTO = z.infer<typeof DeleteDocumentDTOSchema>;
