import { z } from 'zod';

export const AnswerSourceSchema = z.object({
  id: z.string(),
  fileName: z.string().optional(),
  pageNumber: z.union([z.string(), z.number()]).optional(),
  documentId: z.string().optional(),
  chunkKey: z.string().optional(),
  relevance: z.number().min(0).max(1).nullable().optional(),
  textContent: z.string().nullable().optional(),
});

export type AnswerSource = z.infer<typeof AnswerSourceSchema>;

export const AnswerSourcesSchema = z.array(AnswerSourceSchema);

export const AnswerItemSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  text: z.string(),
  confidence: z.number().optional(),
  sources: AnswerSourcesSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AnswerItem = z.infer<typeof AnswerItemSchema>;

export const SaveAnswerDTOSchema = z.object({
  questionId: z.string(),
  text: z.string().min(1, 'Answer text is required'),
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  sources: AnswerSourcesSchema.optional(),
});

export type SaveAnswerDTO = z.infer<typeof SaveAnswerDTOSchema>;

export const AnswerQuestionRequestBodySchema = z.object({
  orgId: z.string().optional(),
  projectId: z.string().min(1),
  questionId: z.string().min(1).optional(),
  question: z.string().min(1).optional(),
  topK: z.number().int().positive().optional(),
}).superRefine((val, ctx) => {
  if (!val.questionId && !val.question?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either questionId (preferred) or question text must be provided',
      path: ['questionId'],
    });
  }
});

export type AnswerQuestionRequestBody = z.infer<typeof AnswerQuestionRequestBodySchema>;

export const BedrockAnswerResultSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  found: z.boolean(),
});

export type BedrockAnswerResult = z.infer<typeof BedrockAnswerResultSchema>;

export const AnswerQuestionResponseSchema = z.object({
  documentId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().optional(),      // you return { answer, confidence, found }
  confidence: z.number().min(0).max(1).optional(),
  found: z.boolean().optional(),
  topK: z.number().int().positive(),
});

export type AnswerQuestionResponse = z.infer<typeof AnswerQuestionResponseSchema>;
