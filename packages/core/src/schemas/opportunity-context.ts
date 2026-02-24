import { z } from 'zod';

// ─── Context Item Types ───────────────────────────────────────────────────────

/** The source system a context item comes from */
export const ContextItemSourceSchema = z.enum([
  'KNOWLEDGE_BASE',
  'PAST_PERFORMANCE',
  'CONTENT_LIBRARY',
  'EXECUTIVE_BRIEF',
]);
export type ContextItemSource = z.infer<typeof ContextItemSourceSchema>;

/**
 * A single context item surfaced for an opportunity.
 * Represents one KB chunk, past-performance project, or content-library snippet
 * that is relevant to the opportunity's solicitation.
 */
export const ContextItemSchema = z.object({
  /** Unique identifier for this context item (chunkKey, projectId, or contentLibraryId) */
  id: z.string().min(1),
  source: ContextItemSourceSchema,
  /** Human-readable title / heading */
  title: z.string(),
  /** Short preview of the content (first ~300 chars) */
  preview: z.string(),
  /** Cosine similarity score from the embedding search (0–1) */
  relevanceScore: z.number().min(0).max(1).optional(),
  /** Additional metadata depending on source */
  metadata: z.record(z.unknown()).optional(),
});
export type ContextItem = z.infer<typeof ContextItemSchema>;

// ─── User Overrides ───────────────────────────────────────────────────────────

/**
 * A user-managed override: either pinning an item (force-include) or
 * excluding an item (force-exclude) from the generation context.
 */
export const ContextOverrideActionSchema = z.enum(['PINNED', 'EXCLUDED']);
export type ContextOverrideAction = z.infer<typeof ContextOverrideActionSchema>;

export const ContextOverrideSchema = z.object({
  id: z.string().min(1),
  source: ContextItemSourceSchema,
  action: ContextOverrideActionSchema,
  /** Optional label the user gave this override */
  label: z.string().optional(),
  addedAt: z.string().datetime(),
  addedBy: z.string(),
});
export type ContextOverride = z.infer<typeof ContextOverrideSchema>;

// ─── Opportunity Context Record (persisted in DynamoDB) ───────────────────────

/**
 * The full opportunity context record stored per project+opportunity.
 * Contains the auto-discovered relevant items plus user overrides.
 */
export const OpportunityContextRecordSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  orgId: z.string().min(1),
  /** Auto-discovered relevant items from semantic search */
  suggestedItems: z.array(ContextItemSchema).default([]),
  /** User-managed overrides (pinned or excluded items) */
  overrides: z.array(ContextOverrideSchema).default([]),
  /** ISO timestamp of last auto-refresh */
  lastRefreshedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type OpportunityContextRecord = z.infer<typeof OpportunityContextRecordSchema>;

// ─── API DTOs ─────────────────────────────────────────────────────────────────

/** GET /opportunity-context response */
export const GetOpportunityContextResponseSchema = z.object({
  ok: z.literal(true),
  /** Auto-suggested items (filtered by relevance, excluding user-excluded items) */
  suggestedItems: z.array(ContextItemSchema),
  /** Items the user has explicitly pinned (always included in generation) */
  pinnedItems: z.array(ContextItemSchema),
  /** Items the user has explicitly excluded */
  excludedIds: z.array(z.string()),
  lastRefreshedAt: z.string().datetime().optional(),
});
export type GetOpportunityContextResponse = z.infer<typeof GetOpportunityContextResponseSchema>;

/** Body for PUT /opportunity-context — upsert a single override */
export const UpsertContextOverrideDTOSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  orgId: z.string().min(1),
  /** The item to pin or exclude */
  item: ContextItemSchema,
  action: ContextOverrideActionSchema,
});
export type UpsertContextOverrideDTO = z.infer<typeof UpsertContextOverrideDTOSchema>;

/** Body for DELETE /opportunity-context — remove a single override */
export const RemoveContextOverrideDTOSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  orgId: z.string().min(1),
  itemId: z.string().min(1),
});
export type RemoveContextOverrideDTO = z.infer<typeof RemoveContextOverrideDTOSchema>;

// ─── DynamoDB Keys ────────────────────────────────────────────────────────────

export const OPPORTUNITY_CONTEXT_PK = 'OPPORTUNITY_CONTEXT';

export function createOpportunityContextSK(
  orgId: string,
  projectId: string,
  opportunityId: string,
): string {
  return `${orgId}#${projectId}#${opportunityId}`;
}
