import { IQuestionExtractionService } from '@/lib/interfaces/ai-service';
import { ExtractQuestionsRequest, ExtractedQuestions, ExtractQuestionsResponse } from '@/lib/validators/extract-questions';
import { openAIQuestionExtractor } from './openai-question-extractor';
import { DatabaseError, AIServiceError } from '@/lib/errors/api-errors';
import { bedrockQuestionExtractor } from '@/lib/services/badrock-question-extractor';

/**
 * Main service for question extraction operations
 */
export class QuestionExtractionService implements IQuestionExtractionService {
  /**
   * Process document and extract questions
   */
  async processDocument(request: ExtractQuestionsRequest): Promise<ExtractQuestionsResponse> {
    try {
      // Stage 1: Extract questions using AI
      const extractedQuestions = await this.extractQuestions(request.content, request.documentName);
      
      // Stage 2: Save to database
      await this.saveQuestions(request.projectId, extractedQuestions.sections);
      
      // Stage 3: Return structured response
      const response: ExtractQuestionsResponse = {
        documentId: request.projectId,
        documentName: request.documentName,
        sections: extractedQuestions.sections,
        extractedAt: new Date().toISOString(),
      };
      
      return response;
    } catch (error) {
      if (error instanceof AIServiceError || error instanceof DatabaseError) {
        throw error;
      }
      throw new AIServiceError(`Document processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Extract questions from content using AI
   */
  private async extractQuestions(content: string, documentName: string): Promise<ExtractedQuestions> {
    try {
      return await bedrockQuestionExtractor.extractQuestions(content, documentName);
    } catch (error) {
      throw new AIServiceError(`AI question extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Save extracted questions to storage
   */
  async saveQuestions(projectId: string, sections: any[]): Promise<void> {
    try {
      // await projectService.saveQuestions(projectId, sections);
    } catch (error) {
      throw new DatabaseError(`Failed to save questions: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get extraction statistics
   */
  getExtractionStats(extractedQuestions: ExtractedQuestions): { sectionCount: number; questionCount: number } {
    const sectionCount = extractedQuestions.sections?.length || 0;
    const questionCount = extractedQuestions.sections?.reduce((total, section) => {
      return total + (section.questions?.length || 0);
    }, 0) || 0;

    return { sectionCount, questionCount };
  }
}

// Export singleton instance
export const questionExtractionService = new QuestionExtractionService(); 