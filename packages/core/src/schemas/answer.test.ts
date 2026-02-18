import { describe, it, expect } from 'vitest';
import {
  AnswerSourceSchema,
  AnswerItemSchema,
  SaveAnswerDTOSchema,
  AnswerQuestionRequestBodySchema,
  BedrockAnswerResultSchema,
} from './answer';

describe('AnswerSourceSchema', () => {
  it('should accept valid answer source', () => {
    const source = {
      id: 'source-123',
      fileName: 'document.pdf',
      pageNumber: 5,
      documentId: 'doc-123',
      chunkKey: 'chunk-456',
      relevance: 0.85,
      textContent: 'Relevant text content',
    };
    const result = AnswerSourceSchema.parse(source);
    expect(result.id).toBe('source-123');
    expect(result.relevance).toBe(0.85);
  });

  it('should require id', () => {
    expect(() => AnswerSourceSchema.parse({})).toThrow();
  });

  it('should accept minimal source with only id', () => {
    const source = { id: 'source-123' };
    const result = AnswerSourceSchema.parse(source);
    expect(result.id).toBe('source-123');
    expect(result.fileName).toBeUndefined();
  });

  it('should accept pageNumber as string or number', () => {
    const sourceWithNumber = { id: '1', pageNumber: 5 };
    const sourceWithString = { id: '2', pageNumber: '5' };

    expect(AnswerSourceSchema.parse(sourceWithNumber).pageNumber).toBe(5);
    expect(AnswerSourceSchema.parse(sourceWithString).pageNumber).toBe('5');
  });

  it('should validate relevance range (0-1)', () => {
    expect(() => AnswerSourceSchema.parse({ id: '1', relevance: 1.5 })).toThrow();
    expect(() => AnswerSourceSchema.parse({ id: '1', relevance: -0.5 })).toThrow();

    expect(AnswerSourceSchema.parse({ id: '1', relevance: 0 }).relevance).toBe(0);
    expect(AnswerSourceSchema.parse({ id: '1', relevance: 1 }).relevance).toBe(1);
    expect(AnswerSourceSchema.parse({ id: '1', relevance: 0.5 }).relevance).toBe(0.5);
  });

  it('should accept null relevance', () => {
    const result = AnswerSourceSchema.parse({ id: '1', relevance: null });
    expect(result.relevance).toBeNull();
  });

  it('should accept null textContent', () => {
    const result = AnswerSourceSchema.parse({ id: '1', textContent: null });
    expect(result.textContent).toBeNull();
  });
});

describe('AnswerItemSchema', () => {
  const validAnswer = {
    id: 'answer-123',
    questionId: 'question-456',
    projectId: 'project-789',
    organizationId: 'org-abc',
    text: 'This is the answer text',
    confidence: 0.9,
    sources: [{ id: 'source-1', fileName: 'doc.pdf' }],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  it('should accept valid answer item', () => {
    const result = AnswerItemSchema.parse(validAnswer);
    expect(result.id).toBe('answer-123');
    expect(result.text).toBe('This is the answer text');
    expect(result.sources).toHaveLength(1);
  });

  it('should require id, questionId, text, createdAt, updatedAt', () => {
    expect(() => AnswerItemSchema.parse({ ...validAnswer, id: undefined })).toThrow();
    expect(() => AnswerItemSchema.parse({ ...validAnswer, questionId: undefined })).toThrow();
    expect(() => AnswerItemSchema.parse({ ...validAnswer, text: undefined })).toThrow();
    expect(() => AnswerItemSchema.parse({ ...validAnswer, createdAt: undefined })).toThrow();
    expect(() => AnswerItemSchema.parse({ ...validAnswer, updatedAt: undefined })).toThrow();
  });

  it('should accept optional fields as undefined', () => {
    const minimalAnswer = {
      id: 'answer-123',
      questionId: 'question-456',
      text: 'Answer text',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };
    const result = AnswerItemSchema.parse(minimalAnswer);
    expect(result.projectId).toBeUndefined();
    expect(result.organizationId).toBeUndefined();
    expect(result.confidence).toBeUndefined();
    expect(result.sources).toBeUndefined();
  });

  it('should accept multiple sources', () => {
    const answerWithMultipleSources = {
      ...validAnswer,
      sources: [
        { id: 'source-1', fileName: 'doc1.pdf', relevance: 0.9 },
        { id: 'source-2', fileName: 'doc2.pdf', relevance: 0.7 },
        { id: 'source-3', fileName: 'doc3.pdf', relevance: 0.5 },
      ],
    };
    const result = AnswerItemSchema.parse(answerWithMultipleSources);
    expect(result.sources).toHaveLength(3);
  });
});

describe('SaveAnswerDTOSchema', () => {
  it('should accept valid save answer DTO', () => {
    const dto = {
      questionId: 'question-123',
      text: 'The answer to the question',
      projectId: 'project-456',
      sources: [{ id: 'source-1' }],
    };
    const result = SaveAnswerDTOSchema.parse(dto);
    expect(result.text).toBe('The answer to the question');
  });

  it('should require questionId and text', () => {
    expect(() => SaveAnswerDTOSchema.parse({ text: 'Answer' })).toThrow();
    expect(() => SaveAnswerDTOSchema.parse({ questionId: 'q-123' })).toThrow();
  });

  it('should reject empty text', () => {
    expect(() =>
      SaveAnswerDTOSchema.parse({
        questionId: 'q-123',
        text: '',
      })
    ).toThrow(/Answer text is required/);
  });

  it('should allow optional fields', () => {
    const dto = {
      questionId: 'question-123',
      text: 'Answer text',
    };
    const result = SaveAnswerDTOSchema.parse(dto);
    expect(result.projectId).toBeUndefined();
    expect(result.organizationId).toBeUndefined();
    expect(result.sources).toBeUndefined();
  });
});

describe('AnswerQuestionRequestBodySchema', () => {
  it('should accept request with questionId', () => {
    const request = {
      projectId: 'project-123',
      questionId: 'question-456',
    };
    const result = AnswerQuestionRequestBodySchema.parse(request);
    expect(result.questionId).toBe('question-456');
  });

  it('should accept request with question text', () => {
    const request = {
      projectId: 'project-123',
      question: 'What is the deadline?',
    };
    const result = AnswerQuestionRequestBodySchema.parse(request);
    expect(result.question).toBe('What is the deadline?');
  });

  it('should accept request with both questionId and question', () => {
    const request = {
      projectId: 'project-123',
      questionId: 'question-456',
      question: 'What is the deadline?',
    };
    const result = AnswerQuestionRequestBodySchema.parse(request);
    expect(result.questionId).toBe('question-456');
    expect(result.question).toBe('What is the deadline?');
  });

  it('should reject request without questionId or question', () => {
    expect(() =>
      AnswerQuestionRequestBodySchema.parse({
        projectId: 'project-123',
      })
    ).toThrow(/Either questionId.*or question text must be provided/);
  });

  it('should reject empty question text when no questionId', () => {
    expect(() =>
      AnswerQuestionRequestBodySchema.parse({
        projectId: 'project-123',
        question: '   ', // whitespace only
      })
    ).toThrow();
  });

  it('should require projectId', () => {
    expect(() =>
      AnswerQuestionRequestBodySchema.parse({
        questionId: 'question-123',
      })
    ).toThrow();
  });

  it('should accept optional topK parameter', () => {
    const request = {
      projectId: 'project-123',
      questionId: 'question-456',
      topK: 10,
    };
    const result = AnswerQuestionRequestBodySchema.parse(request);
    expect(result.topK).toBe(10);
  });

  it('should reject non-positive topK', () => {
    expect(() =>
      AnswerQuestionRequestBodySchema.parse({
        projectId: 'project-123',
        questionId: 'question-456',
        topK: 0,
      })
    ).toThrow();

    expect(() =>
      AnswerQuestionRequestBodySchema.parse({
        projectId: 'project-123',
        questionId: 'question-456',
        topK: -5,
      })
    ).toThrow();
  });
});

describe('BedrockAnswerResultSchema', () => {
  it('should accept valid bedrock result', () => {
    const result = BedrockAnswerResultSchema.parse({
      answer: 'The deadline is January 15, 2025',
      confidence: 0.95,
      found: true,
    });
    expect(result.answer).toBe('The deadline is January 15, 2025');
    expect(result.confidence).toBe(0.95);
    expect(result.found).toBe(true);
  });

  it('should require all fields', () => {
    expect(() => BedrockAnswerResultSchema.parse({ answer: 'Test', found: true })).toThrow();
    expect(() => BedrockAnswerResultSchema.parse({ confidence: 0.5, found: true })).toThrow();
    expect(() => BedrockAnswerResultSchema.parse({ answer: 'Test', confidence: 0.5 })).toThrow();
  });

  it('should validate confidence range (0-1)', () => {
    expect(() =>
      BedrockAnswerResultSchema.parse({
        answer: 'Test',
        confidence: 1.5,
        found: true,
      })
    ).toThrow();

    expect(() =>
      BedrockAnswerResultSchema.parse({
        answer: 'Test',
        confidence: -0.1,
        found: true,
      })
    ).toThrow();
  });

  it('should accept edge case confidence values', () => {
    const resultZero = BedrockAnswerResultSchema.parse({
      answer: 'Not found',
      confidence: 0,
      found: false,
    });
    expect(resultZero.confidence).toBe(0);

    const resultOne = BedrockAnswerResultSchema.parse({
      answer: 'Certain answer',
      confidence: 1,
      found: true,
    });
    expect(resultOne.confidence).toBe(1);
  });

  it('should accept found as false', () => {
    const result = BedrockAnswerResultSchema.parse({
      answer: 'No relevant information found',
      confidence: 0.1,
      found: false,
    });
    expect(result.found).toBe(false);
  });
});
