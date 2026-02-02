import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';

export const DocumentItemSchema = z.object({
  [PK_NAME]: z.literal(DOCUMENT_PK),         // PK = "DOCUMENT"
  [SK_NAME]: z.string(),                     // SK = "KB#<knowledgeBaseId>#DOC#<id>"

  // Document metadata
  id: z.string(),                     // uuid
  knowledgeBaseId: z.string(),        // belongs to this KB
  name: z.string(),
  fileKey: z.string(),                // original PDF / uploaded file
  textFileKey: z.string(),            // extracted text file in S3

  indexStatus: z.enum(['pending', 'processing', 'ready', 'failed']),
  indexVectorKey: z.string().optional(), // embeddings file or vector DB key

  taskToken: z.string().optional().nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
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
  indexStatus: z.enum(['pending', 'processing', 'ready', 'failed']).optional(),
  indexVectorKey: z.string().optional(),
});

export type UpdateDocumentDTO = z.infer<typeof UpdateDocumentDTOSchema>;

export const DeleteDocumentDTOSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  knowledgeBaseId: z.string(),
});

export type DeleteDocumentDTO = z.infer<typeof DeleteDocumentDTOSchema>;
