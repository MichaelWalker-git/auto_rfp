import { z } from 'zod';

// ─── Confidence Breakdown (Enhanced Multi-Factor Algorithm) ───

export const CONFIDENCE_WEIGHTS = {
  contextRelevance: 0.40,
  sourceRecency: 0.25,
  answerCoverage: 0.20,
  sourceAuthority: 0.10,
  consistency: 0.05,
} as const;

export const ConfidenceBreakdownSchema = z.object({
  contextRelevance: z.number().min(0).max(100),
  sourceRecency: z.number().min(0).max(100),
  answerCoverage: z.number().min(0).max(100),
  sourceAuthority: z.number().min(0).max(100),
  consistency: z.number().min(0).max(100),
});

export type ConfidenceBreakdown = z.infer<typeof ConfidenceBreakdownSchema>;

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function getConfidenceBand(score: number): ConfidenceBand {
  if (score >= 90) return 'high';
  if (score >= 70) return 'medium';
  return 'low';
}

export function getConfidenceBandLabel(band: ConfidenceBand): string {
  const labels: Record<ConfidenceBand, string> = {
    high: '🟢 High (minimal review needed)',
    medium: '🟡 Medium (verify facts)',
    low: '🔴 Low (requires attention)',
  };
  return labels[band];
}

// ─── Answer Source ───

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

// ─── Answer Status ───

export const AnswerStatusSchema = z.enum(['DRAFT', 'APPROVED']);
export type AnswerStatus = z.infer<typeof AnswerStatusSchema>;

// ─── Answer Item ───

export const AnswerItemSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
  text: z.string(),
  status: AnswerStatusSchema.default('DRAFT'),
  confidence: z.number().optional(),
  confidenceBreakdown: ConfidenceBreakdownSchema.optional(),
  confidenceBand: z.enum(['high', 'medium', 'low']).optional(),
  sources: AnswerSourcesSchema.optional(),
  // Approval fields
  approvedBy: z.string().optional(),       // userId of approver
  approvedByName: z.string().optional(),   // display name of approver
  approvedAt: z.string().optional(),       // ISO datetime
  // Last edit tracking
  updatedBy: z.string().optional(),        // userId of last editor
  updatedByName: z.string().optional(),    // display name of last editor
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
  status: AnswerStatusSchema.optional(),
  // Approval fields — set by backend when status = APPROVED
  approvedBy: z.string().optional(),
  approvedByName: z.string().optional(),
  approvedAt: z.string().optional(),
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
