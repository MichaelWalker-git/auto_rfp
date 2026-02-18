import { z } from 'zod';

export const QuestionItemSchema = z.object({
  projectId: z.string().optional(),
  questionFileId: z.string().optional(),
  questionId: z.string().uuid(),
  question: z.string().optional(),
  sectionId: z.string().uuid(),
  sectionTitle: z.string().optional(),
  sectionDescription: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  // Clustering fields
  clusterId: z.string().optional(),
  isClusterMaster: z.boolean().optional(),
  similarityToMaster: z.number().min(0).max(1).optional(),
  linkedToMasterQuestionId: z.string().optional(),
});

export type QuestionItem = z.infer<typeof QuestionItemSchema>;

export const GroupedQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().nullable(),
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
  documentId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string(),
  createdAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  found: z.boolean(),
  source: z.string().optional(),
});

export type QAItem = z.infer<typeof QAItemSchema>;