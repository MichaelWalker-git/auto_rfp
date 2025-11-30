import { ExtractedQuestions, ExtractQuestionsRequest } from '@/lib/validators/extract-questions';

/**
 * Interface for AI-powered question extraction services
 */
export interface IAIQuestionExtractor {
  /**
   * Extract structured questions from document content
   */
  extractQuestions(content: string, documentName: string): Promise<ExtractedQuestions>;
}

/**
 * Configuration for AI services
 */
export interface AIServiceConfig {
  model: string;
  temperature: number;
  maxTokens?: number;
  timeout?: number;
}

/**
 * Interface for question extraction service
 */
export interface IQuestionExtractionService {
  /**
   * Process document and extract questions
   */
  processDocument(request: ExtractQuestionsRequest): Promise<ExtractedQuestions>;
  
  /**
   * Save extracted questions to storage
   */
  saveQuestions(projectId: string, sections: any[]): Promise<void>;
} 