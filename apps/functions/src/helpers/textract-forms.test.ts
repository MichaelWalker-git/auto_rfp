const mockTextractSend = jest.fn();
jest.mock('@aws-sdk/client-textract', () => ({
  TextractClient: jest.fn(() => ({ send: mockTextractSend })),
  AnalyzeDocumentCommand: jest.fn((params) => ({ type: 'AnalyzeDocument', params })),
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

import { analyzeDocumentForms, analyzeDocumentFormsSafe } from './textract-forms';

describe('textract-forms helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTextractSend.mockReset();
  });

  describe('analyzeDocumentForms', () => {
    it('extracts key-value pairs from Textract response', async () => {
      mockTextractSend.mockResolvedValue({
        Blocks: [
          { Id: 'k1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Text: '', Confidence: 95, Page: 1,
            Relationships: [
              { Type: 'CHILD', Ids: ['w1'] },
              { Type: 'VALUE', Ids: ['v1'] },
            ],
            Geometry: { BoundingBox: { Top: 0.1, Left: 0.1, Width: 0.3, Height: 0.02 } },
          },
          { Id: 'w1', BlockType: 'WORD', Text: 'Company Name' },
          { Id: 'v1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'],
            Relationships: [{ Type: 'CHILD', Ids: ['w2'] }],
          },
          { Id: 'w2', BlockType: 'WORD', Text: 'Acme' },
        ],
      });

      const fields = await analyzeDocumentForms('docs/form.pdf');

      expect(fields).toHaveLength(1);
      expect(fields[0]!.label).toBe('Company Name');
      expect(fields[0]!.value).toBe('Acme');
      expect(fields[0]!.status).toBe('LOW_CONFIDENCE');
      expect(fields[0]!.manualReason).toContain('Pre-filled');
      expect(fields[0]!.pageNumber).toBe(1);
    });

    it('filters out noise fields', async () => {
      mockTextractSend.mockResolvedValue({
        Blocks: [
          { Id: 'k1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 90, Page: 1,
            Relationships: [{ Type: 'CHILD', Ids: ['w1'] }, { Type: 'VALUE', Ids: ['v1'] }],
          },
          { Id: 'w1', BlockType: 'WORD', Text: 'X' }, // too short
          { Id: 'v1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'], Relationships: [] },
        ],
      });

      const fields = await analyzeDocumentForms('docs/form.pdf');

      expect(fields).toHaveLength(0);
    });

    it('detects checkboxes and marks as MANUAL_REQUIRED', async () => {
      mockTextractSend.mockResolvedValue({
        Blocks: [
          { Id: 'k1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['KEY'], Confidence: 92, Page: 1,
            Relationships: [{ Type: 'CHILD', Ids: ['w1'] }, { Type: 'VALUE', Ids: ['v1'] }],
          },
          { Id: 'w1', BlockType: 'WORD', Text: 'Tax Exempt' },
          { Id: 'v1', BlockType: 'KEY_VALUE_SET', EntityTypes: ['VALUE'],
            Relationships: [{ Type: 'CHILD', Ids: ['sel1'] }],
          },
          { Id: 'sel1', BlockType: 'SELECTION_ELEMENT', SelectionStatus: 'NOT_SELECTED' },
        ],
      });

      const fields = await analyzeDocumentForms('docs/form.pdf');

      expect(fields).toHaveLength(1);
      expect(fields[0]!.status).toBe('MANUAL_REQUIRED');
      expect(fields[0]!.value).toBe('No');
    });

    it('returns empty array when no blocks', async () => {
      mockTextractSend.mockResolvedValue({ Blocks: [] });

      const fields = await analyzeDocumentForms('docs/empty.pdf');

      expect(fields).toEqual([]);
    });
  });

  describe('analyzeDocumentFormsSafe', () => {
    it('returns fields with fallback=false on success', async () => {
      mockTextractSend.mockResolvedValue({ Blocks: [] });

      const result = await analyzeDocumentFormsSafe('docs/form.pdf');

      expect(result.fallback).toBe(false);
      expect(result.fields).toEqual([]);
    });

    it('returns fallback=true on unsupported document format', async () => {
      mockTextractSend.mockRejectedValue(new Error('Request has unsupported document format'));

      const result = await analyzeDocumentFormsSafe('docs/multipage.pdf');

      expect(result.fallback).toBe(true);
      expect(result.fields).toEqual([]);
    });

    it('re-throws non-format errors', async () => {
      mockTextractSend.mockRejectedValue(new Error('AccessDenied'));

      await expect(analyzeDocumentFormsSafe('docs/form.pdf')).rejects.toThrow('AccessDenied');
    });
  });
});
