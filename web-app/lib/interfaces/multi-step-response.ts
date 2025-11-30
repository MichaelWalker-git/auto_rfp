import { z } from 'zod';

/**
 * Multi-step response generation interfaces
 */

// Step types for the reasoning process
export type StepType = 
  | 'analyze_question'
  | 'search_documents' 
  | 'extract_information'
  | 'synthesize_response'
  | 'validate_answer';

// Individual step status
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed';

// Step result interface
export interface StepResult {
  id: string;
  type: StepType;
  title: string;
  description: string;
  status: StepStatus;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  output?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// Question analysis result
export interface QuestionAnalysis {
  complexity: 'simple' | 'moderate' | 'complex' | 'multi-part';
  requiredInformation: string[];
  specificEntities: string[];
  searchQueries: string[];
  expectedSources: number;
  reasoning: string;
}

// Document search result
export interface DocumentSearchResult {
  query: string;
  documentsFound: number;
  relevantSources: Array<{
    id: string;
    title: string;
    relevanceScore: number;
    snippet: string;
  }>;
  coverage: 'complete' | 'partial' | 'insufficient';
}

// Information extraction result
export interface InformationExtraction {
  extractedFacts: Array<{
    fact: string;
    source: string;
    confidence: number;
  }>;
  missingInformation: string[];
  conflictingInformation: Array<{
    topic: string;
    conflictingSources: string[];
  }>;
}

// Response synthesis result
export interface ResponseSynthesis {
  mainResponse: string;
  confidence: number;
  sources: Array<{
    id: string;
    relevance: number;
    usedInResponse: boolean;
  }>;
  limitations: string[];
  recommendations: string[];
}

// Complete multi-step response
export interface MultiStepResponse {
  id: string;
  questionId: string;
  steps: StepResult[];
  finalResponse: string;
  overallConfidence: number;
  totalDuration: number;
  sources: Array<{
    id: string;
    fileName: string;
    relevance: number;
    pageNumber?: string;
    textContent?: string;
  }>;
  metadata: {
    modelUsed: string;
    tokensUsed: number;
    stepsCompleted: number;
    processingStartTime: Date;
    processingEndTime: Date;
  };
}

// Request interface
export interface MultiStepGenerateRequest {
  question: string;
  questionId: string;
  projectId: string;
  indexIds: string[];
  context?: string;
  userPreferences?: {
    detailLevel: 'brief' | 'standard' | 'comprehensive';
    includeRecommendations: boolean;
    showReasoning: boolean;
  };
}

// Streaming step update interface
export interface StepUpdate {
  stepId: string;
  status: StepStatus;
  progress?: number;
  partialOutput?: any;
  estimatedTimeRemaining?: number;
}

/**
 * Service interface for multi-step response generation
 */
export interface IMultiStepResponseService {
  /**
   * Generate response using multi-step reasoning
   */
  generateResponse(request: MultiStepGenerateRequest): Promise<MultiStepResponse>;
  
  /**
   * Get step-by-step updates (for streaming)
   */
  generateResponseStream(
    request: MultiStepGenerateRequest
  ): AsyncGenerator<StepUpdate | MultiStepResponse>;
  
  /**
   * Get detailed step information
   */
  getStepDetails(stepId: string): Promise<StepResult | null>;
}

/**
 * Configuration for multi-step processing
 */
export interface MultiStepConfig {
  maxSteps: number;
  timeoutPerStep: number;
  enableDetailedLogging: boolean;
  fallbackToSingleStep: boolean;
  minConfidenceThreshold: number;
} 