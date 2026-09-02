import { describe, it, expect } from 'vitest';
import { DocumentItemSchema, UpdateDocumentDTOSchema } from './document';

const baseDocument = {
  id: 'doc-1',
  knowledgeBaseId: 'kb-1',
  name: 'Test Document',
  fileKey: 'files/doc-1.pdf',
  textFileKey: 'files/doc-1.txt',
  indexStatus: 'INDEXED' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('DocumentItemSchema.chunkCount', () => {
  it('is optional when absent', () => {
    const { success, data } = DocumentItemSchema.safeParse(baseDocument);
    expect(success).toBe(true);
    expect(data?.chunkCount).toBeUndefined();
  });

  it('accepts zero and positive integers', () => {
    expect(DocumentItemSchema.safeParse({ ...baseDocument, chunkCount: 0 }).success).toBe(true);
    expect(DocumentItemSchema.safeParse({ ...baseDocument, chunkCount: 42 }).success).toBe(true);
  });

  it('rejects negative numbers', () => {
    const result = DocumentItemSchema.safeParse({ ...baseDocument, chunkCount: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integers', () => {
    const result = DocumentItemSchema.safeParse({ ...baseDocument, chunkCount: 1.5 });
    expect(result.success).toBe(false);
  });
});

describe('UpdateDocumentDTOSchema.name', () => {
  const base = { id: 'doc-1', knowledgeBaseId: 'kb-1' };

  it('is optional when absent', () => {
    const { success, data } = UpdateDocumentDTOSchema.safeParse(base);
    expect(success).toBe(true);
    expect(data?.name).toBeUndefined();
  });

  it('trims surrounding whitespace', () => {
    const { success, data } = UpdateDocumentDTOSchema.safeParse({ ...base, name: '  My Document.pdf  ' });
    expect(success).toBe(true);
    expect(data?.name).toBe('My Document.pdf');
  });

  it('rejects an empty string', () => {
    const result = UpdateDocumentDTOSchema.safeParse({ ...base, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a whitespace-only string (trimmed to empty)', () => {
    const result = UpdateDocumentDTOSchema.safeParse({ ...base, name: '   ' });
    expect(result.success).toBe(false);
  });

  it('accepts a name at the 255-character limit', () => {
    const result = UpdateDocumentDTOSchema.safeParse({ ...base, name: 'a'.repeat(255) });
    expect(result.success).toBe(true);
  });

  it('rejects a name over 255 characters', () => {
    const result = UpdateDocumentDTOSchema.safeParse({ ...base, name: 'a'.repeat(256) });
    expect(result.success).toBe(false);
  });
});
