// lambda/schemas/answer.ts
import { z } from 'zod';

//
// ================================
// ANSWER SCHEMA (DB Item)
// ================================
//

export const AnswerItemSchema = z.object({
  id: z.string(),                // uuid
  questionId: z.string(),        // link to question
  projectId: z.string().optional(),
  organizationId: z.string().optional(),

  text: z.string(),              // the actual answer text
  source: z.string().optional(), // e.g. "manual", "rag" etc.

  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AnswerItem = z.infer<typeof AnswerItemSchema>;

//
// ================================
// DTOs (API Input)
// ================================
//

export const CreateAnswerDTOSchema = z.object({
  questionId: z.string(),
  text: z.string().min(1, 'Answer text is required'),

  // optional, so you can associate later if needed
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
});

export type CreateAnswerDTO = z.infer<typeof CreateAnswerDTOSchema>;
