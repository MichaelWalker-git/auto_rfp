import { z } from 'zod';

// --- Shared count schema ---
export const KnowledgeBaseCountSchema = z.object({
  questions: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
});

// --- Base KB fields (what the client sends) ---
export const KnowledgeBaseBaseSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be at most 255 characters'),
  description: z
    .string()
    .max(2000, 'Description must be at most 2000 characters')
    .optional(),
});

export const CreateKnowledgeBaseSchema = KnowledgeBaseBaseSchema;

export type CreateKnowledgeBaseDTO = z.infer<typeof CreateKnowledgeBaseSchema>;

// --- Shape of the item stored in DynamoDB ---
export const KnowledgeBaseItemSchema = KnowledgeBaseBaseSchema.extend({
  orgId: z.string(),              // owning organization
  createdAt: z.string(),          // ISO date
  updatedAt: z.string(),          // ISO date

  _count: KnowledgeBaseCountSchema.default({ questions: 0, documents: 0 }),
});

export type KnowledgeBaseItem = z.infer<typeof KnowledgeBaseItemSchema>;

export const KnowledgeBaseSchema = KnowledgeBaseBaseSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  _count: KnowledgeBaseCountSchema,
});

export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;

/**
 * DTO for "update" operation (PATCH-style)
 * All fields optional — Lambdas update only what is provided.
 */
export const UpdateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  description: z.string().optional().nullable(),
});

export type UpdateKnowledgeBaseDTO = z.infer<typeof UpdateKnowledgeBaseSchema>;
