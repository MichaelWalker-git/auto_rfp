import { z } from 'zod';

// Input validation schema
export const ExtractQuestionsRequestSchema = z.object({
  documentId: z.string().min(1, 'Document ID is required'),
  documentName: z.string().min(1, 'Document name is required'),
  content: z.string().min(1, 'Document content is required'),
  projectId: z.string().min(1, 'Project ID is required'),
});

// Output validation schema
export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
});

export const SectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  questions: z.array(QuestionSchema),
});

export const ExtractedQuestionsSchema = z.object({
  sections: z.array(SectionSchema),
});

export const ExtractQuestionsResponseSchema = z.object({
  documentId: z.string(),
  documentName: z.string(),
  sections: z.array(SectionSchema),
  extractedAt: z.string(),
});

// Type exports
export type ExtractQuestionsRequest = z.infer<typeof ExtractQuestionsRequestSchema>;
export type ExtractedQuestions = z.infer<typeof ExtractedQuestionsSchema>;
export type ExtractQuestionsResponse = z.infer<typeof ExtractQuestionsResponseSchema>;
export type Section = z.infer<typeof SectionSchema>;
export type Question = z.infer<typeof QuestionSchema>; 