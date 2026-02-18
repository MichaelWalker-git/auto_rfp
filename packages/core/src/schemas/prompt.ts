import { z } from 'zod';

export const PromptScopeSchema = z.enum(['SYSTEM', 'USER']);
export type PromptScope = z.infer<typeof PromptScopeSchema>;

export const PromptTypeSchema =
  z.enum(['PROPOSAL', 'SUMMARY', 'REQUIREMENTS', 'CONTACTS', 'RISK', 'DEADLINE', 'SCORING', 'ANSWER']);

export type PromptType = z.infer<typeof PromptTypeSchema>;

export const PromptItemSchema = z.object({
  prompt: z.string().optional(),
  orgId: z.string().optional(),
  type: PromptTypeSchema.optional(),
  params: z.array(z.string()).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  scope: z.string().optional(),
});

export type PromptItem = z.infer<typeof PromptItemSchema>;

export const SavePromptBodySchema = z.object({
  type: PromptTypeSchema,
  prompt: z.string().min(1, 'prompt is required'),
  params: z.array(z.string()).optional(),
});