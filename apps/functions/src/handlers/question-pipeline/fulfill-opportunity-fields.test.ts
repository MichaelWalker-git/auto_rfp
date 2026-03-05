// Mock uuid (ESM compatibility)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

// Mock AWS SDK — use var so it is hoisted along with jest.mock
// eslint-disable-next-line no-var
var mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

// Mock S3
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn(),
}));

// Mock Bedrock
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: jest.fn(),
}));

// Mock opportunity helpers
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: jest.fn(),
  updateOpportunity: jest.fn(),
}));

// Mock questionFile helpers
jest.mock('@/helpers/questionFile', () => ({
  getQuestionFileItem: jest.fn(),
  updateQuestionFile: jest.fn(),
  checkQuestionFileCancelled: jest.fn(),
}));

import { baseHandler, buildBedrockMessagesBody } from './fulfill-opportunity-fields';
import { loadTextFromS3 } from '@/helpers/s3';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { getOpportunity, updateOpportunity } from '@/helpers/opportunity';
import { getQuestionFileItem, updateQuestionFile, checkQuestionFileCancelled } from '@/helpers/questionFile';

const mockLoadTextFromS3 = loadTextFromS3 as jest.MockedFunction<typeof loadTextFromS3>;
const mockInvokeModel = invokeModel as jest.MockedFunction<typeof invokeModel>;
const mockGetOpportunity = getOpportunity as jest.MockedFunction<typeof getOpportunity>;
const mockUpdateOpportunity = updateOpportunity as jest.MockedFunction<typeof updateOpportunity>;
const mockGetQuestionFileItem = getQuestionFileItem as jest.MockedFunction<typeof getQuestionFileItem>;
const mockUpdateQuestionFile = updateQuestionFile as jest.MockedFunction<typeof updateQuestionFile>;
const mockCheckCancelled = checkQuestionFileCancelled as jest.MockedFunction<typeof checkQuestionFileCancelled>;

const makeBedrockResponse = (fields: Record<string, unknown>, confidence = 0.9) => {
  const modelText = JSON.stringify({ fields, confidence });
  const envelope = JSON.stringify({ content: [{ type: 'text', text: modelText }] });
  return new TextEncoder().encode(envelope);
};

const validEvent = {
  opportunityId: 'opp-1',
  projectId: 'proj-1',
  questionFileId: 'qf-1',
  textFileKey: 'text/rfp.txt',
};

const mockQf = {
  questionFileId: 'qf-1',
  projectId: 'proj-1',
  oppId: 'opp-1',
  orgId: 'org-1',
  status: 'PROCESSING' as const,
  createdAt: '2024-01-01T00:00:00.000Z',
};

describe('fulfill-opportunity-fields', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockCheckCancelled.mockResolvedValue(false);
    mockUpdateQuestionFile.mockResolvedValue({ success: true });
    mockUpdateOpportunity.mockResolvedValue(undefined as never);
  });

  // ─── buildBedrockMessagesBody ─────────────────────────────────────────────────

  describe('buildBedrockMessagesBody', () => {
    it('includes document text in user message', () => {
      const body = buildBedrockMessagesBody('Sample RFP text');
      expect(body.messages[0].content[0].text).toContain('Sample RFP text');
    });

    it('truncates document text to 180k chars', () => {
      const longText = 'x'.repeat(200_000);
      const body = buildBedrockMessagesBody(longText);
      expect(body.messages[0].content[0].text.length).toBeLessThan(200_000);
    });
  });

  // ─── baseHandler ─────────────────────────────────────────────────────────────

  describe('baseHandler', () => {
    it('returns cancelled when pipeline is cancelled', async () => {
      mockCheckCancelled.mockResolvedValueOnce(true);

      const result = await baseHandler(validEvent);

      expect(result).toEqual({ ok: true, opportunityId: 'opp-1', cancelled: true, updatedFieldCount: 0 });
      expect(mockGetQuestionFileItem).not.toHaveBeenCalled();
    });

    it('throws when required fields are missing', async () => {
      await expect(
        baseHandler({ opportunityId: 'opp-1', textFileKey: 'key.txt' }),
      ).rejects.toThrow('projectId, questionFileId, textFileKey and opportunityId are all required');
    });

    it('throws when question file not found or missing orgId', async () => {
      mockGetQuestionFileItem.mockResolvedValueOnce(null);

      await expect(baseHandler(validEvent)).rejects.toThrow('Question file not found or missing orgId');
    });

    it('skips processing for SAM_GOV opportunity and marks as PROCESSED', async () => {
      mockGetQuestionFileItem.mockResolvedValueOnce(mockQf);
      mockGetOpportunity.mockResolvedValueOnce({ item: { source: 'SAM_GOV' } } as never);

      const result = await baseHandler(validEvent);

      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.updatedFieldCount).toBe(0);
      expect(mockUpdateQuestionFile).toHaveBeenCalledWith('proj-1', 'opp-1', 'qf-1', { status: 'PROCESSED' });
      expect(mockInvokeModel).not.toHaveBeenCalled();
    });

    it('extracts fields from Bedrock and updates opportunity', async () => {
      mockGetQuestionFileItem.mockResolvedValueOnce(mockQf);
      mockGetOpportunity.mockResolvedValueOnce({ item: { source: 'DIBBS' } } as never);
      mockLoadTextFromS3.mockResolvedValueOnce('RFP document text');
      mockInvokeModel.mockResolvedValueOnce(
        makeBedrockResponse({ title: 'Test RFP', solicitationNumber: 'W911NF-24-R-0001' }),
      );

      const result = await baseHandler(validEvent);

      expect(result.ok).toBe(true);
      expect(result.updatedFieldCount).toBe(2);
      expect(result.confidence).toBe(0.9);
      expect(mockUpdateOpportunity).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1',
          projectId: 'proj-1',
          oppId: 'opp-1',
          patch: { title: 'Test RFP', solicitationNumber: 'W911NF-24-R-0001' },
        }),
      );
      expect(mockUpdateQuestionFile).toHaveBeenCalledWith('proj-1', 'opp-1', 'qf-1', { status: 'PROCESSED' });
    });

    it('returns ok:false and marks FAILED when Bedrock returns no fields', async () => {
      mockGetQuestionFileItem.mockResolvedValueOnce(mockQf);
      mockGetOpportunity.mockResolvedValueOnce({ item: { source: 'DIBBS' } } as never);
      mockLoadTextFromS3.mockResolvedValueOnce('RFP text');
      // Bedrock returns no fields
      const envelope = JSON.stringify({ content: [{ type: 'text', text: '{}' }] });
      mockInvokeModel.mockResolvedValueOnce(new TextEncoder().encode(envelope));

      const result = await baseHandler(validEvent);

      expect(result.ok).toBe(false);
      expect(mockUpdateQuestionFile).toHaveBeenCalledWith(
        'proj-1', 'opp-1', 'qf-1',
        expect.objectContaining({ status: 'FAILED' }),
      );
    });

    it('returns ok:false and marks FAILED when S3 text is empty', async () => {
      mockGetQuestionFileItem.mockResolvedValueOnce(mockQf);
      mockGetOpportunity.mockResolvedValueOnce({ item: { source: 'DIBBS' } } as never);
      mockLoadTextFromS3.mockResolvedValueOnce('');

      const result = await baseHandler(validEvent);

      expect(result.ok).toBe(false);
      expect(mockUpdateQuestionFile).toHaveBeenCalledWith(
        'proj-1', 'opp-1', 'qf-1',
        expect.objectContaining({ status: 'FAILED' }),
      );
    });

    it('returns ok:false and marks FAILED when Bedrock throws', async () => {
      mockGetQuestionFileItem.mockResolvedValueOnce(mockQf);
      mockGetOpportunity.mockResolvedValueOnce({ item: { source: 'DIBBS' } } as never);
      mockLoadTextFromS3.mockResolvedValueOnce('RFP text');
      mockInvokeModel.mockRejectedValueOnce(new Error('Bedrock timeout'));

      const result = await baseHandler(validEvent);

      expect(result.ok).toBe(false);
      expect(mockUpdateQuestionFile).toHaveBeenCalledWith(
        'proj-1', 'opp-1', 'qf-1',
        expect.objectContaining({ status: 'FAILED', errorMessage: 'Bedrock timeout' }),
      );
    });
  });
});
