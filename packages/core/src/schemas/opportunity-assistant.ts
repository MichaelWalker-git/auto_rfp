import { z } from 'zod';

// ─── Source Citation Schema ────────────────────────────────────────────────────

export const ChatSourceCitationSchema = z.object({
  /** Unique ID for this source reference */
  sourceId: z.string(),
  /** Question file ID (solicitation document) */
  questionFileId: z.string(),
  /** File name/path (frontend extracts display name) */
  fileName: z.string(),
  /** Chunk index within the file */
  chunkIndex: z.number().int().min(0),
  /** Excerpt from the chunk used as context */
  excerpt: z.string(),
  /** Relevance score from Pinecone (0-1) */
  relevance: z.number().min(0).max(1),
});

export type ChatSourceCitation = z.infer<typeof ChatSourceCitationSchema>;

// ─── Chat Message Schema ───────────────────────────────────────────────────────

export const OpportunityAssistantMessageRoleSchema = z.enum(['user', 'assistant']);
export type OpportunityAssistantMessageRole = z.infer<typeof OpportunityAssistantMessageRoleSchema>;

export const OpportunityAssistantMessageSchema = z.object({
  messageId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  role: OpportunityAssistantMessageRoleSchema,
  content: z.string(),
  /** Sources cited in the response (assistant messages only) */
  sources: z.array(ChatSourceCitationSchema).optional(),
  /** User who sent the message */
  userId: z.string().optional(),
  createdAt: z.string().datetime(),
});

export type OpportunityAssistantMessage = z.infer<typeof OpportunityAssistantMessageSchema>;

// ─── API Request/Response Schemas ──────────────────────────────────────────────

export const OpportunityAssistantChatRequestSchema = z.object({
  message: z.string().min(1, 'Message is required').max(2000, 'Message too long'),
});

export type OpportunityAssistantChatRequest = z.infer<typeof OpportunityAssistantChatRequestSchema>;

export const OpportunityAssistantChatResponseSchema = z.object({
  answer: z.string(),
  sources: z.array(ChatSourceCitationSchema),
  messageId: z.string().uuid(),
});

export type OpportunityAssistantChatResponse = z.infer<typeof OpportunityAssistantChatResponseSchema>;

export const OpportunityAssistantHistoryResponseSchema = z.object({
  messages: z.array(OpportunityAssistantMessageSchema),
});

export type OpportunityAssistantHistoryResponse = z.infer<typeof OpportunityAssistantHistoryResponseSchema>;

// ─── Indexing Status ───────────────────────────────────────────────────────────

export const OpportunityIndexStatusSchema = z.enum([
  'NOT_INDEXED',
  'INDEXING',
  'INDEXED',
  'FAILED',
]);

export type OpportunityIndexStatus = z.infer<typeof OpportunityIndexStatusSchema>;
