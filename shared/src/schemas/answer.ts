import { z } from 'zod';

export const AnswerQuestionRequestBodySchema = z.object({
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

// --- LLM result (your Bedrock JSON contract) ---
export const BedrockAnswerResultSchema = z.object({
  answer: z.string(),
  confidence: z.number().min(0).max(1),
  found: z.boolean(),
});

export type BedrockAnswerResult = z.infer<typeof BedrockAnswerResultSchema>;

// --- API response (success) ---
export const AnswerQuestionResponseSchema = z.object({
  documentId: z.string().min(1),
  questionId: z.string().min(1),
  answer: z.string().optional(),      // you return { answer, confidence, found }
  confidence: z.number().min(0).max(1).optional(),
  found: z.boolean().optional(),
  topK: z.number().int().positive(),
});

export type AnswerQuestionResponse = z.infer<typeof AnswerQuestionResponseSchema>;
