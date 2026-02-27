import { z } from 'zod';

/**
 * Category of clarifying question based on the type of ambiguity identified
 */
export const ClarifyingQuestionCategorySchema = z.enum([
  'SCOPE',
  'TECHNICAL',
  'PRICING',
  'SCHEDULE',
  'COMPLIANCE',
  'EVALUATION',
  'OTHER',
]);

export type ClarifyingQuestionCategory = z.infer<typeof ClarifyingQuestionCategorySchema>;

/**
 * Priority level for clarifying questions
 */
export const ClarifyingQuestionPrioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export type ClarifyingQuestionPriority = z.infer<typeof ClarifyingQuestionPrioritySchema>;

/**
 * Status tracking for clarifying questions through their lifecycle
 */
export const ClarifyingQuestionStatusSchema = z.enum([
  'SUGGESTED', // AI-generated, awaiting review
  'REVIEWED', // User has reviewed and accepted
  'SUBMITTED', // Question has been submitted to contracting officer
  'ANSWERED', // Response received from contracting officer
  'DISMISSED', // User dismissed this question
]);

export type ClarifyingQuestionStatus = z.infer<typeof ClarifyingQuestionStatusSchema>;

/**
 * Source reference pointing to the RFP section that triggered this question
 */
export const AmbiguitySourceSchema = z.object({
  documentId: z.string().optional().nullable(),
  snippet: z.string().optional().nullable(),
  sectionRef: z.string().optional().nullable(),
  chunkKey: z.string().optional().nullable(),
});

export type AmbiguitySource = z.infer<typeof AmbiguitySourceSchema>;

/**
 * Main schema for AI-generated clarifying questions
 */
export const ClarifyingQuestionItemSchema = z.object({
  // Identifiers
  questionId: z.string().uuid(),
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),

  // AI-generated content
  question: z.string().min(10, 'Question must be at least 10 characters'),
  category: ClarifyingQuestionCategorySchema,
  rationale: z.string().min(10, 'Rationale must explain why this question is valuable'),
  priority: ClarifyingQuestionPrioritySchema,
  ambiguitySource: AmbiguitySourceSchema.optional().nullable(),

  // Status tracking
  status: ClarifyingQuestionStatusSchema.default('SUGGESTED'),

  // Submission tracking (manual logging)
  submittedAt: z.string().datetime().optional().nullable(),
  submittedBy: z.string().optional().nullable(),
  responseReceived: z.boolean().default(false),
  responseReceivedAt: z.string().datetime().optional().nullable(),

  // User notes (for pasting CO response or other notes)
  notes: z.string().optional().nullable(),

  // Timestamps
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type ClarifyingQuestionItem = z.infer<typeof ClarifyingQuestionItemSchema>;

/**
 * Schema for creating a new clarifying question (omits auto-generated fields)
 */
export const CreateClarifyingQuestionSchema = ClarifyingQuestionItemSchema.omit({
  questionId: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateClarifyingQuestionDTO = z.infer<typeof CreateClarifyingQuestionSchema>;

/**
 * Schema for updating a clarifying question
 */
export const UpdateClarifyingQuestionSchema = z.object({
  status: ClarifyingQuestionStatusSchema.optional(),
  submittedAt: z.string().datetime().optional().nullable(),
  submittedBy: z.string().optional().nullable(),
  responseReceived: z.boolean().optional(),
  responseReceivedAt: z.string().datetime().optional().nullable(),
  notes: z.string().optional().nullable(),
  question: z.string().min(10).optional(), // Allow editing the question text
  priority: ClarifyingQuestionPrioritySchema.optional(),
});

export type UpdateClarifyingQuestionDTO = z.infer<typeof UpdateClarifyingQuestionSchema>;

/**
 * Response schema for listing clarifying questions
 */
export const ClarifyingQuestionsResponseSchema = z.object({
  ok: z.boolean(),
  items: z.array(ClarifyingQuestionItemSchema),
  count: z.number().int().nonnegative(),
  nextToken: z.string().optional().nullable(),
});

export type ClarifyingQuestionsResponse = z.infer<typeof ClarifyingQuestionsResponseSchema>;

/**
 * Request schema for generating clarifying questions
 */
export const GenerateClarifyingQuestionsRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  executiveBriefId: z.string().min(1).optional(), // Optional, will look up if not provided
  force: z.boolean().default(false), // Force regeneration even if questions exist
  topK: z.number().int().min(1).max(20).default(10), // Number of questions to generate
});

export type GenerateClarifyingQuestionsRequest = z.infer<typeof GenerateClarifyingQuestionsRequestSchema>;

/**
 * Response schema for generating clarifying questions
 */
export const GenerateClarifyingQuestionsResponseSchema = z.object({
  ok: z.boolean(),
  projectId: z.string().optional(),
  opportunityId: z.string().optional(),
  questionsGenerated: z.number().int().nonnegative().optional(),
  questions: z.array(ClarifyingQuestionItemSchema).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

export type GenerateClarifyingQuestionsResponse = z.infer<typeof GenerateClarifyingQuestionsResponseSchema>;
