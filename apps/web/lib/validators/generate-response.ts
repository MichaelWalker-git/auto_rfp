import { z } from 'zod';

export const generateResponseSchema = z.object({
  question: z.string().min(1, 'Question is required').max(1000, 'Question too long'),
  documentIds: z.array(z.string()).optional().default([]),
  selectedIndexIds: z.array(z.string()).optional().default([]),
  useAllIndexes: z.boolean().optional().default(false),
  projectId: z.string().min(1, 'Project ID is required'),
});

export type GenerateResponseRequest = z.infer<typeof generateResponseSchema>;

export const generateResponseMetadataSchema = z.object({
  confidence: z.number().min(0).max(1),
  generatedAt: z.string(),
  indexesUsed: z.array(z.string()),
  note: z.string().optional(),
});

export type GenerateResponseMetadata = z.infer<typeof generateResponseMetadataSchema>;

export const generateResponseSchema_Response = z.object({
  success: z.boolean(),
  response: z.string(),
  sources: z.array(z.object({
    id: z.number(),
    fileName: z.string(),
    filePath: z.string().optional(),
    pageNumber: z.string().optional(),
    documentId: z.string().optional(),
    relevance: z.number().optional(),
    textContent: z.string().optional(),
  })),
  metadata: generateResponseMetadataSchema,
});

export type GenerateResponseResponse = z.infer<typeof generateResponseSchema_Response>; 