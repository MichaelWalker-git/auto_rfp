import { z } from 'zod';

// ─── Multiple-choice support ──────────────────────────────────────────────────

// How a question expects to be answered. TEXT is the default and covers every
// pre-existing question (free-text narrative). SINGLE_CHOICE = radio buttons
// (pick one), MULTI_CHOICE = checkboxes (pick any). Mirrors the enum idiom used
// by the required-forms domain (FieldMarkTypeSchema).
export const QuestionResponseKindSchema = z.enum([
  'TEXT',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
]);
export type QuestionResponseKind = z.infer<typeof QuestionResponseKindSchema>;

// One selectable answer option for a SINGLE_CHOICE / MULTI_CHOICE question.
// `label` is the human-readable choice ("React", "Yes"); `value` preserves the
// original marker from the source document when present ("A", "(1)", "☐").
export const QuestionOptionSchema = z.object({
  label: z.string().min(1),
  value: z.string().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

// ─── Create Question DTOs ─────────────────────────────────────────────────────

export const CreateQuestionInputSchema = z.object({
  question: z.string().min(1, 'Question text is required'),
});
export type CreateQuestionInput = z.infer<typeof CreateQuestionInputSchema>;

export const CreateQuestionSectionSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  questions: z.array(CreateQuestionInputSchema).min(1, 'At least one question is required'),
});
export type CreateQuestionSection = z.infer<typeof CreateQuestionSectionSchema>;

export const CreateQuestionsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
  questionFileId: z.string().optional(),
  sections: z.array(CreateQuestionSectionSchema).min(1, 'At least one section is required'),
});
export type CreateQuestions = z.infer<typeof CreateQuestionsSchema>;

export const QuestionItemSchema = z.object({
  projectId: z.string().optional(),
  opportunityId: z.string().optional(),
  questionFileId: z.string().optional(),
  // AI-extracted questions use a sha256 hex hash of the normalized question text
  // as their id; manually-created questions use a uuid. So this is NOT
  // constrained to uuid — .uuid() here silently rejected every extracted
  // question had the schema ever been parsed at runtime.
  questionId: z.string(),
  question: z.string().optional(),
  sectionId: z.string().uuid(),
  sectionTitle: z.string().optional(),
  sectionDescription: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Source row for questionnaire files (1-indexed XLSX row number)
  sourceRow: z.number().int().min(1).optional(),
  // Multiple-choice support. Absent/`TEXT` = free-text (the default for every
  // legacy question). When SINGLE_CHOICE / MULTI_CHOICE, `options` carries the
  // selectable answers so a radio/checkbox question stays whole instead of
  // being split into one question per option.
  responseKind: QuestionResponseKindSchema.optional(),
  options: z.array(QuestionOptionSchema).optional(),
  // Clustering fields
  clusterId: z.string().optional(),
  isClusterMaster: z.boolean().optional(),
  similarityToMaster: z.number().min(0).max(1).optional(),
  linkedToMasterQuestionId: z.string().optional(),
  // Approval (mirrors AnswerItem.approvedBy/approvedByName/approvedAt)
  approvedBy: z.string().optional(),
  approvedByName: z.string().optional(),
  approvedAt: z.string().datetime().optional(),
});

export type QuestionItem = z.infer<typeof QuestionItemSchema>;

// ─── Approve Question DTO ─────────────────────────────────────────────────────

export const ApproveQuestionDTOSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  questionFileId: z.string().min(1),
  questionId: z.string().min(1),
});
export type ApproveQuestionDTO = z.infer<typeof ApproveQuestionDTOSchema>;

export const GroupedQuestionSchema = z.object({
  id: z.string().min(1),
  opportunityId: z.string().optional(),
  questionFileId: z.string().optional(),
  question: z.string().min(1),
  answer: z.string().nullable(),
  // Multiple-choice support — surfaced to the UI so the editor can render a
  // radio group / checkbox list instead of a free-text box.
  responseKind: QuestionResponseKindSchema.optional(),
  options: z.array(QuestionOptionSchema).optional(),
  // Clustering fields for UI display
  clusterId: z.string().optional(),
  isClusterMaster: z.boolean().optional(),
  similarityToMaster: z.number().min(0).max(1).optional(),
  linkedToMasterQuestionId: z.string().optional(),
});

export type GroupedQuestion = z.infer<typeof GroupedQuestionSchema>;

export const GroupedSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  questions: z.array(GroupedQuestionSchema),
});

export type GroupedSection = z.infer<typeof GroupedSectionSchema>;

export const QAItemSchema = z.object({
  questionId: z.string().min(1),
  opportunityId: z.string().optional(),
  questionFileId: z.string().optional(),
  documentId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string(),
  createdAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  found: z.boolean(),
  source: z.string().optional(),
});

export type QAItem = z.infer<typeof QAItemSchema>;