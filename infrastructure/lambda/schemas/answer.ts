import { z } from 'zod';


export const AnswerItemSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  documentId: z.string().optional(),

  text: z.string(),
  confidence: z.number().optional(),
  source: z.string().optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AnswerItem = z.infer<typeof AnswerItemSchema>;

export const CreateAnswerDTOSchema = z.object({
  questionId: z.string(),
  text: z.string().min(1, 'Answer text is required'),
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
});

export type CreateAnswerDTO = z.infer<typeof CreateAnswerDTOSchema>;
