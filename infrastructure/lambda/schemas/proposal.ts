import { z } from 'zod';

export const QuestionAnswerSchema = z.object({
  questionId: z.string().uuid().optional().or(z.string()),
  question: z.string(),
  answer: z.string(),
});

// Snippets coming from knowledge base (past performance, capability statement, etc.)
export const KnowledgeBaseSnippetSchema = z.object({
  id: z.string().optional(),
  type: z
    .enum(['PAST_PERFORMANCE', 'CAPABILITY_STATEMENT', 'RESUME', 'OTHER'])
    .optional(),
  title: z.string().optional(),
  content: z.string(), // raw text chunk
  sourceDocumentName: z.string().optional(),
});

export const ProposalMetadataSchema = z.object({
  opportunityId: z.string().optional(),
  rfpTitle: z.string().optional(),
  customerName: z.string().optional(),
  agencyName: z.string().optional(),
  dueDate: z.string().optional(), // ISO date, but keep as string
  contractType: z.string().optional(),
  naicsCode: z.string().optional(),
  notes: z.string().optional(),
});

// Lambda input schema
export const GenerateProposalRequestSchema = z.object({
  projectId: z.string().optional(),
  proposalMetadata: ProposalMetadataSchema,
  qaPairs: z.array(QuestionAnswerSchema).nonempty(),
  knowledgeBaseSnippets: z.array(KnowledgeBaseSnippetSchema).optional(),
  // Optional: allow caller to override section list / template
  requestedSections: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

// Proposal structure (for PDF assembly)
export const ProposalSubsectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(), // ready-to-render rich text (Markdown-ish / paragraphs)
});

export const ProposalSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  subsections: z.array(ProposalSubsectionSchema),
});

export const ProposalDocumentSchema = z.object({
  proposalTitle: z.string(),
  customerName: z.string().optional(),
  opportunityId: z.string().optional(),
  outlineSummary: z.string().optional(),
  sections: z.array(ProposalSectionSchema).nonempty(),
});

export type GenerateProposalRequest = z.infer<typeof GenerateProposalRequestSchema>;
export type ProposalDocument = z.infer<typeof ProposalDocumentSchema>;
