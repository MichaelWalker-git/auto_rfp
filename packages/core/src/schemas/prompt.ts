import { z } from 'zod';

export const PromptScopeSchema = z.enum(['SYSTEM', 'USER']);
export type PromptScope = z.infer<typeof PromptScopeSchema>;

export const PromptTypeSchema =
  z.enum(['TECHNICAL_PROPOSAL', 'SUMMARY', 'REQUIREMENTS', 'CONTACTS', 'RISK', 'DEADLINE', 'SCORING', 'ANSWER', 'CLARIFYING_QUESTIONS', 'PROPOSAL', 'RFP_DOCUMENT']);

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

// ── Document generation prompt overrides ──
// Document types whose generation prompt fragments (guidance/task) can be
// overridden per org. Excludes CLARIFYING_QUESTIONS / QUESTIONS_AND_ANSWERS /
// QUESTIONNAIRE (dedicated pipelines, not driven by DOC_TYPE_GUIDANCE/DOC_TYPE_TASK)
// and non-generated admin types (NDA, CONTRACT, …).
export const DocumentPromptTypeSchema = z.enum([
  'COVER_LETTER',
  'EXECUTIVE_SUMMARY',
  'UNDERSTANDING_OF_REQUIREMENTS',
  'TECHNICAL_PROPOSAL',
  'PROJECT_PLAN',
  'TEAM_QUALIFICATIONS',
  'PAST_PERFORMANCE',
  'COST_PROPOSAL',
  'MANAGEMENT_APPROACH',
  'RISK_MANAGEMENT',
  'COMPLIANCE_MATRIX',
  'CERTIFICATIONS',
  'APPENDICES',
  'MANAGEMENT_PROPOSAL',
  'PRICE_VOLUME',
  'QUALITY_MANAGEMENT',
]);
export type DocumentPromptType = z.infer<typeof DocumentPromptTypeSchema>;

/** Max chars per fragment. Fragments are ~1–2k today; the cap protects the
 *  generation context budget from oversized pastes. */
export const DOCUMENT_PROMPT_MAX_LENGTH = 8000;

export const DocumentPromptItemSchema = z.object({
  documentType: DocumentPromptTypeSchema,
  scope: PromptScopeSchema,
  prompt: z.string(),
  orgId: z.string().optional(),
  isDefault: z.boolean().optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});
export type DocumentPromptItem = z.infer<typeof DocumentPromptItemSchema>;

export const SaveDocumentPromptBodySchema = z.object({
  documentType: DocumentPromptTypeSchema,
  prompt: z
    .string()
    .trim()
    .min(1, 'prompt is required')
    .max(DOCUMENT_PROMPT_MAX_LENGTH, `prompt must be at most ${DOCUMENT_PROMPT_MAX_LENGTH} characters`),
});
export type SaveDocumentPromptBody = z.infer<typeof SaveDocumentPromptBodySchema>;

export const DeleteDocumentPromptBodySchema = z.object({
  documentType: DocumentPromptTypeSchema,
});
export type DeleteDocumentPromptBody = z.infer<typeof DeleteDocumentPromptBodySchema>;