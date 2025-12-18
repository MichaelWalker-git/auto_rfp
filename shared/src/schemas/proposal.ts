import { z } from 'zod';

/**
 * Status for proposal workflow (UI + backend).
 * Keep this in shared so Lambdas + Next.js use the same enum.
 */
export enum ProposalStatus {
  NEW = 'NEW',
  NEED_REVIEW = 'NEED_REVIEW',
  IN_REVIEW = 'IN_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export const ProposalStatusSchema = z.nativeEnum(ProposalStatus);

/**
 * Q/A pairs used for generation requests (optional to export if needed).
 */
export const QuestionAnswerSchema = z.object({
  questionId: z.string().optional(), // UUID or any string; keep permissive
  question: z.string(),
  answer: z.string(),
});

export type QuestionAnswer = z.infer<typeof QuestionAnswerSchema>;

/**
 * Snippets coming from knowledge base (past performance, capability statement, etc.)
 */
export const KnowledgeBaseSnippetSchema = z.object({
  id: z.string().optional(),
  type: z
    .enum(['PAST_PERFORMANCE', 'CAPABILITY_STATEMENT', 'RESUME', 'OTHER'])
    .optional(),
  title: z.string().optional(),
  content: z.string(),
  sourceDocumentName: z.string().optional(),
});

export type KnowledgeBaseSnippet = z.infer<typeof KnowledgeBaseSnippetSchema>;

export const ProposalMetadataSchema = z.object({
  opportunityId: z.string().optional(),
  rfpTitle: z.string().optional(),
  customerName: z.string().optional(),
  agencyName: z.string().optional(),
  dueDate: z.string().optional(), // ISO string
  contractType: z.string().optional(),
  naicsCode: z.string().optional(),
  notes: z.string().optional(),
});

export type ProposalMetadata = z.infer<typeof ProposalMetadataSchema>;

/**
 * Lambda input schema for generation
 */
export const GenerateProposalRequestSchema = z.object({
  projectId: z.string().optional(),
  proposalMetadata: ProposalMetadataSchema,
  qaPairs: z.array(QuestionAnswerSchema).min(1, 'At least one question-answer pair is required'),
  knowledgeBaseSnippets: z.array(KnowledgeBaseSnippetSchema).optional(),
  requestedSections: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  status: ProposalStatusSchema.optional().default(ProposalStatus.NEW),
});

export type GenerateProposalRequest = z.infer<typeof GenerateProposalRequestSchema>;

/**
 * Proposal document structure (render to PDF / UI)
 */
export const ProposalSubsectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
});

export type ProposalSubsection = z.infer<typeof ProposalSubsectionSchema>;

export const ProposalSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().nullable().optional(),
  subsections: z.array(ProposalSubsectionSchema),
});

export type ProposalSection = z.infer<typeof ProposalSectionSchema>;

export const ProposalDocumentSchema = z.object({
  proposalTitle: z.string(),
  customerName: z.string().nullable().optional(),
  opportunityId: z.string().nullable().optional(),
  outlineSummary: z.string().nullable().optional(),
  sections: z.array(ProposalSectionSchema).min(1, 'At least one section is required'),
});

export type ProposalDocument = z.infer<typeof ProposalDocumentSchema>;

export const ProposalSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  organizationId: z.string().nullable().optional(),
  status: ProposalStatusSchema,
  title: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  document: ProposalDocumentSchema,
});

export type Proposal = z.infer<typeof ProposalSchema>;

/**
 * List response
 */
export const ProposalListResponseSchema = z.object({
  items: z.array(ProposalSchema),
  count: z.number(),
});

export type ProposalListResponse = z.infer<typeof ProposalListResponseSchema>;

/**
 * Save request: allow server to fill create-only fields.
 * (Still standard entity shape, so no mappers.)
 */
export const SaveProposalRequestSchema = ProposalSchema.partial({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  projectId: z.string().min(1),
  status: ProposalStatusSchema.optional().default(ProposalStatus.NEW),
  document: ProposalDocumentSchema,
});

export type SaveProposalRequest = z.infer<typeof SaveProposalRequestSchema>;

// ====== Input schema ======
export const GenerateProposalInputSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
});

export type GenerateProposalInput = z.infer<typeof GenerateProposalInputSchema>;


export const SaveProposalInputSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
  organizationId: z.string().min(1).optional().nullable(),

  // Optional: if you want stable id across updates, client can send one.
  // If not provided, we generate one at save-time for new records only.
  proposalId: z.string().min(1).optional().nullable(),

  proposal: ProposalDocumentSchema,

  status: z.nativeEnum(ProposalStatus).optional().default(ProposalStatus.NEW),
  title: z.string().min(1).optional().nullable(),
});

export type SaveProposalInput = z.infer<typeof SaveProposalInputSchema>;
