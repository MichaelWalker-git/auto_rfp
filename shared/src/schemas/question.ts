import { z } from 'zod';

export const QAItemSchema = z.object({
  questionId: z.string().min(1),
  documentId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string(),
  createdAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  found: z.boolean(),
  source: z.string().optional(),
});

export type QAItem = z.infer<typeof QAItemSchema>;