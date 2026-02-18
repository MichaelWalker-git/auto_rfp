import { z } from 'zod';

// Step validation schemas
export const StepTypeSchema = z.enum([
  'analyze_question',
  'search_documents', 
  'extract_information',
  'synthesize_response',
  'validate_answer'
]);

export const StepStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export const StepResultSchema = z.object({
  id: z.string(),
  type: StepTypeSchema,
  title: z.string(),
  description: z.string(),
  status: StepStatusSchema,
  startTime: z.date(),
  endTime: z.date().optional(),
  duration: z.number().optional(),
  output: z.any().optional(),
  error: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

// Question analysis validation
export const QuestionAnalysisSchema = z.object({
  complexity: z.enum(['simple', 'moderate', 'complex', 'multi-part']),
  requiredInformation: z.array(z.string()),
  specificEntities: z.array(z.string()),
  searchQueries: z.array(z.string()),
  expectedSources: z.number(),
  reasoning: z.string(),
});

// Document search validation
export const DocumentSearchResultSchema = z.object({
  query: z.string(),
  documentsFound: z.number(),
  relevantSources: z.array(z.object({
    id: z.string(),
    title: z.string(),
    relevanceScore: z.number(),
    snippet: z.string(),
  })),
  coverage: z.enum(['complete', 'partial', 'insufficient']),
});

// Information extraction validation
export const InformationExtractionSchema = z.object({
  extractedFacts: z.array(z.object({
    fact: z.string(),
    source: z.string(),
    confidence: z.number(),
  })),
  missingInformation: z.array(z.string()),
  conflictingInformation: z.array(z.object({
    topic: z.string(),
    conflictingSources: z.array(z.string()),
  })),
});

// Response synthesis validation
export const ResponseSynthesisSchema = z.object({
  mainResponse: z.string(),
  confidence: z.number(),
  sources: z.array(z.object({
    id: z.string(),
    relevance: z.number(),
    usedInResponse: z.boolean(),
  })),
  limitations: z.array(z.string()),
  recommendations: z.array(z.string()),
});

// Multi-step request validation
export const MultiStepGenerateRequestSchema = z.object({
  question: z.string().min(1, 'Question is required'),
  questionId: z.string().min(1, 'Question ID is required'),
  projectId: z.string().min(1, 'Project ID is required'),
  indexIds: z.array(z.string()).min(1, 'At least one index ID is required'),
  context: z.string().optional(),
  userPreferences: z.object({
    detailLevel: z.enum(['brief', 'standard', 'comprehensive']).default('standard'),
    includeRecommendations: z.boolean().default(true),
    showReasoning: z.boolean().default(true),
  }).optional(),
});

// Multi-step response validation
export const MultiStepResponseSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  steps: z.array(StepResultSchema),
  finalResponse: z.string(),
  overallConfidence: z.number(),
  totalDuration: z.number(),
  sources: z.array(z.object({
    id: z.string(),
    fileName: z.string(),
    relevance: z.number(),
    pageNumber: z.string().optional(),
    textContent: z.string().optional(),
  })),
  metadata: z.object({
    modelUsed: z.string(),
    tokensUsed: z.number(),
    stepsCompleted: z.number(),
    processingStartTime: z.date(),
    processingEndTime: z.date(),
  }),
});

// Step update validation (for streaming)
export const StepUpdateSchema = z.object({
  stepId: z.string(),
  status: StepStatusSchema,
  progress: z.number().optional(),
  partialOutput: z.any().optional(),
  estimatedTimeRemaining: z.number().optional(),
});

// Configuration validation
export const MultiStepConfigSchema = z.object({
  maxSteps: z.number().min(1).max(10).default(5),
  timeoutPerStep: z.number().min(1000).default(30000),
  enableDetailedLogging: z.boolean().default(true),
  fallbackToSingleStep: z.boolean().default(true),
  minConfidenceThreshold: z.number().min(0).max(1).default(0.7),
});

// Type exports
export type StepType = z.infer<typeof StepTypeSchema>;
export type StepStatus = z.infer<typeof StepStatusSchema>;
export type StepResult = z.infer<typeof StepResultSchema>;
export type QuestionAnalysis = z.infer<typeof QuestionAnalysisSchema>;
export type DocumentSearchResult = z.infer<typeof DocumentSearchResultSchema>;
export type InformationExtraction = z.infer<typeof InformationExtractionSchema>;
export type ResponseSynthesis = z.infer<typeof ResponseSynthesisSchema>;
export type MultiStepGenerateRequest = z.infer<typeof MultiStepGenerateRequestSchema>;
export type MultiStepResponse = z.infer<typeof MultiStepResponseSchema>;
export type StepUpdate = z.infer<typeof StepUpdateSchema>;
export type MultiStepConfig = z.infer<typeof MultiStepConfigSchema>; 