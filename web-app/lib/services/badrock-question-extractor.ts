import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { IAIQuestionExtractor, AIServiceConfig } from '@/lib/interfaces/ai-service';
import { ExtractedQuestions, ExtractedQuestionsSchema } from '@/lib/validators/extract-questions';
import { DEFAULT_LANGUAGE_MODEL } from '@/lib/constants';
import { AIServiceError } from '@/lib/errors/api-errors';
import {env} from '@/lib/env'

/**
 * Bedrock-powered question extraction service
 */
export class BedrockQuestionExtractor implements IAIQuestionExtractor {
  private client?: BedrockRuntimeClient;
  private config: AIServiceConfig;

  constructor(config: Partial<AIServiceConfig> = {}) {
    this.config = {
      model: process.env.BEDROCK_MODEL_ID || DEFAULT_LANGUAGE_MODEL,
      temperature: 0.1,
      maxTokens: 4000,
      timeout: 60000,
      ...config,
    };
  }

  /**
   * Lazy initialization of Bedrock client
   */
  private getClient(): BedrockRuntimeClient {
    if (!this.client) {
      if (!env.AWS_REGION) {
        throw new AIServiceError('AWS_REGION is not configured for Bedrock');
      }

      this.client = new BedrockRuntimeClient({
        region: env.AWS_REGION,
        // credentials will be taken from environment/role by default
      });
    }
    return this.client;
  }

  /**
   * Extract structured questions from document content
   */
  async extractQuestions(content: string, documentName: string): Promise<ExtractedQuestions> {
    try {
      const systemPrompt = this.getSystemPrompt();
      const client = this.getClient();

      // Claude 3-style request payload for Bedrock
      const body = {
        messages: [
          {
            role: 'system',
            content: [
              {
                type: 'text',
                text: systemPrompt,
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: this.formatUserPrompt(content, documentName),
              },
            ],
          },
        ],
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        // Encourage strict JSON object output
        response_format: { type: 'json' },
      };

      const command = new InvokeModelCommand({
        modelId: this.config.model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
      });

      const response = await client.send(command);

      if (!response.body) {
        throw new AIServiceError('Empty response body from Bedrock');
      }

      const responseString = new TextDecoder('utf-8').decode(response.body);

      let parsed;
      try {
        parsed = JSON.parse(responseString);
      } catch {
        throw new AIServiceError('Invalid JSON envelope from Bedrock');
      }

      /**
       * Claude on Bedrock returns something like:
       * {
       *   "id": "...",
       *   "type": "message",
       *   "role": "assistant",
       *   "content": [
       *     { "type": "text", "text": "{...your JSON here...}" }
       *   ],
       *   ...
       * }
       */
      const assistantText =
        parsed?.content?.[0]?.text ??
        parsed?.output_text ?? // fallback for other models
        null;

      if (!assistantText || typeof assistantText !== 'string') {
        throw new AIServiceError('Empty response from Bedrock model');
      }

      // Parse and validate the JSON response from the model
      const rawData = JSON.parse(assistantText);
      const extractedData = ExtractedQuestionsSchema.parse(rawData);

      return extractedData;
    } catch (error) {
      if (error instanceof SyntaxError) {
        // JSON.parse of assistantText failed
        throw new AIServiceError('Invalid JSON response from AI service');
      }
      if (error instanceof AIServiceError) {
        throw error;
      }
      throw new AIServiceError(
        `Question extraction failed (Bedrock): ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Get the system prompt for question extraction
   */
  private getSystemPrompt(): string {
    const timestamp = Date.now();
    return `
You are an expert at analyzing RFP (Request for Proposal) documents and extracting structured information.
Given a document that contains RFP questions, extract all sections and questions into a structured format.

Carefully identify:
1. Different sections (usually numbered like 1.1, 1.2, etc.)
2. The questions within each section
3. Any descriptive text that provides context for the section

Format the output as a JSON object with the following structure:
{
  "sections": [
    {
      "id": "section_${timestamp}_1",
      "title": "Section Title",
      "description": "Optional description text for the section",
      "questions": [
        {
          "id": "q_${timestamp}_1_1",
          "question": "The exact text of the question"
        }
      ]
    }
  ]
}

Requirements:
- Generate unique reference IDs using the format: q_${timestamp}_<section>_<question> for questions
- Generate unique reference IDs using the format: section_${timestamp}_<number> for sections  
- Preserve the exact text of questions
- Include all questions found in the document
- Group questions correctly under their sections
- If a section has subsections, create separate sections for each subsection
- The timestamp prefix (${timestamp}) ensures uniqueness across different document uploads

Return ONLY the JSON object, with no additional text.
    `.trim();
  }

  /**
   * Format the user prompt with context
   */
  private formatUserPrompt(content: string, documentName: string): string {
    return `Document Name: ${documentName}\n\nDocument Content:\n${content}`;
  }
}

// Export singleton instance
export const bedrockQuestionExtractor = new BedrockQuestionExtractor();
