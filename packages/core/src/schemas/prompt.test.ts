import { describe, it, expect } from 'vitest';
import {
  DocumentPromptTypeSchema,
  DocumentPromptItemSchema,
  SaveDocumentPromptBodySchema,
  DeleteDocumentPromptBodySchema,
  DOCUMENT_PROMPT_MAX_LENGTH,
  PromptScopeSchema,
  PromptTypeSchema,
  SavePromptBodySchema,
} from './prompt';

describe('DocumentPromptTypeSchema', () => {
  const expectedTypes = [
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
  ];

  it('contains exactly the 16 built-in generatable document types', () => {
    expect(DocumentPromptTypeSchema.options).toEqual(expectedTypes);
  });

  it.each(expectedTypes)('accepts %s', (type) => {
    expect(DocumentPromptTypeSchema.safeParse(type).success).toBe(true);
  });

  it('rejects types with dedicated pipelines', () => {
    expect(DocumentPromptTypeSchema.safeParse('CLARIFYING_QUESTIONS').success).toBe(false);
    expect(DocumentPromptTypeSchema.safeParse('QUESTIONS_AND_ANSWERS').success).toBe(false);
    expect(DocumentPromptTypeSchema.safeParse('QUESTIONNAIRE').success).toBe(false);
  });

  it('rejects legacy feature prompt types', () => {
    expect(DocumentPromptTypeSchema.safeParse('RFP_DOCUMENT').success).toBe(false);
    expect(DocumentPromptTypeSchema.safeParse('PROPOSAL').success).toBe(false);
  });

  it('rejects unknown values', () => {
    expect(DocumentPromptTypeSchema.safeParse('CUSTOM_TYPE').success).toBe(false);
    expect(DocumentPromptTypeSchema.safeParse('').success).toBe(false);
  });
});

describe('DocumentPromptItemSchema', () => {
  const validItem = {
    documentType: 'COST_PROPOSAL',
    scope: 'SYSTEM',
    prompt: 'Custom guidance text',
  };

  it('validates a minimal item', () => {
    expect(DocumentPromptItemSchema.safeParse(validItem).success).toBe(true);
  });

  it('validates a full item with optional fields', () => {
    const result = DocumentPromptItemSchema.safeParse({
      ...validItem,
      orgId: 'org-123',
      isDefault: true,
      createdAt: '2026-08-04T10:00:00Z',
      updatedAt: '2026-08-04T11:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('requires documentType, scope, and prompt', () => {
    expect(DocumentPromptItemSchema.safeParse({ ...validItem, documentType: undefined }).success).toBe(false);
    expect(DocumentPromptItemSchema.safeParse({ ...validItem, scope: undefined }).success).toBe(false);
    expect(DocumentPromptItemSchema.safeParse({ ...validItem, prompt: undefined }).success).toBe(false);
  });

  it('rejects invalid scope values', () => {
    expect(DocumentPromptItemSchema.safeParse({ ...validItem, scope: 'ADMIN' }).success).toBe(false);
  });

  it('rejects invalid datetime strings', () => {
    expect(DocumentPromptItemSchema.safeParse({ ...validItem, createdAt: 'yesterday' }).success).toBe(false);
  });
});

describe('SaveDocumentPromptBodySchema', () => {
  it('accepts a valid body', () => {
    const { success, data } = SaveDocumentPromptBodySchema.safeParse({
      documentType: 'TECHNICAL_PROPOSAL',
      prompt: 'Write with a focus on measurable outcomes.',
    });
    expect(success).toBe(true);
    expect(data?.documentType).toBe('TECHNICAL_PROPOSAL');
  });

  it('rejects an empty prompt', () => {
    const { success, error } = SaveDocumentPromptBodySchema.safeParse({
      documentType: 'COVER_LETTER',
      prompt: '',
    });
    expect(success).toBe(false);
    expect(error?.issues[0]?.message).toBe('prompt is required');
  });

  it('rejects a whitespace-only prompt', () => {
    const { success } = SaveDocumentPromptBodySchema.safeParse({
      documentType: 'COVER_LETTER',
      prompt: '   \n\t  ',
    });
    expect(success).toBe(false);
  });

  it(`accepts a prompt of exactly ${DOCUMENT_PROMPT_MAX_LENGTH} chars`, () => {
    const result = SaveDocumentPromptBodySchema.safeParse({
      documentType: 'COVER_LETTER',
      prompt: 'a'.repeat(DOCUMENT_PROMPT_MAX_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it(`rejects a prompt over ${DOCUMENT_PROMPT_MAX_LENGTH} chars`, () => {
    const result = SaveDocumentPromptBodySchema.safeParse({
      documentType: 'COVER_LETTER',
      prompt: 'a'.repeat(DOCUMENT_PROMPT_MAX_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown documentType', () => {
    const result = SaveDocumentPromptBodySchema.safeParse({
      documentType: 'NDA',
      prompt: 'text',
    });
    expect(result.success).toBe(false);
  });

  it('has no params field (document prompts take no placeholders)', () => {
    expect('params' in SaveDocumentPromptBodySchema.shape).toBe(false);
  });
});

describe('DeleteDocumentPromptBodySchema', () => {
  it('accepts a valid documentType', () => {
    expect(DeleteDocumentPromptBodySchema.safeParse({ documentType: 'PRICE_VOLUME' }).success).toBe(true);
  });

  it('rejects a missing documentType', () => {
    expect(DeleteDocumentPromptBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown documentType', () => {
    expect(DeleteDocumentPromptBodySchema.safeParse({ documentType: 'CONTRACT' }).success).toBe(false);
  });
});

describe('DOCUMENT_PROMPT_MAX_LENGTH', () => {
  it('is 8000', () => {
    expect(DOCUMENT_PROMPT_MAX_LENGTH).toBe(8000);
  });
});

describe('existing prompt schemas (regression)', () => {
  it('PromptScopeSchema accepts SYSTEM and USER only', () => {
    expect(PromptScopeSchema.safeParse('SYSTEM').success).toBe(true);
    expect(PromptScopeSchema.safeParse('USER').success).toBe(true);
    expect(PromptScopeSchema.safeParse('DOCUMENT').success).toBe(false);
  });

  it('PromptTypeSchema keeps legacy types for data compat', () => {
    expect(PromptTypeSchema.safeParse('RFP_DOCUMENT').success).toBe(true);
    expect(PromptTypeSchema.safeParse('PROPOSAL').success).toBe(true);
    expect(PromptTypeSchema.safeParse('TECHNICAL_PROPOSAL').success).toBe(true);
  });

  it('SavePromptBodySchema still validates feature prompt bodies', () => {
    const { success } = SavePromptBodySchema.safeParse({
      type: 'ANSWER',
      prompt: 'Answer prompt',
      params: ['CONTEXT'],
    });
    expect(success).toBe(true);
  });
});
