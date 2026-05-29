import { z } from 'zod';

export const KBTypeSchema = z.enum(['DOCUMENTS', 'CONTENT_LIBRARY']);

export type KBType = z.infer<typeof KBTypeSchema>;

export const KBCountSchema = z.object({
  questions: z.number().optional().nullable().default(0),
  documents: z.number().optional().nullable().default(0),
});

export const KnowledgeBaseItemSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(255, 'Name must be at most 255 characters'),
  description: z
    .string()
    .max(2000, 'Description must be at most 2000 characters')
    .optional(),
  type: KBTypeSchema.default('DOCUMENTS'),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  _count: KBCountSchema.optional().nullable()
});

export type KnowledgeBaseItem = z.infer<typeof KnowledgeBaseItemSchema>;

export const CreateKnowledgeBaseSchema = KnowledgeBaseItemSchema;

export type CreateKnowledgeBase = z.infer<typeof CreateKnowledgeBaseSchema>;

export const UpdateKnowledgeBaseSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  description: z.string().optional().nullable(),
});

export type UpdateKnowledgeBaseDTO = z.infer<typeof UpdateKnowledgeBaseSchema>;

export const KnowledgeBaseSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'Name cannot be empty'),
  description: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  orgId: z.string(),
  type: KBTypeSchema.default('DOCUMENTS'),
  _count: KBCountSchema
});


export type KnowledgeBase = z.infer<typeof KnowledgeBaseSchema>;