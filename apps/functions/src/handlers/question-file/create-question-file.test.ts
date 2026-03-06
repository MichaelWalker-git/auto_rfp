// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock uuid (ESM compatibility)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-file-uuid'),
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
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
}));

import { baseHandler } from './create-question-file';
import { createQuestionFile } from '@/helpers/questionFile';
import type { CreateQuestionFileRequest } from '@auto-rfp/core';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

describe('create-question-file', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  // ─── createQuestionFile helper ────────────────────────────────────────────────

  describe('createQuestionFile', () => {
    it('creates a question file record with correct structure', async () => {
      mockSend.mockResolvedValue({});

      const request: CreateQuestionFileRequest = {
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
      };

      const result = await createQuestionFile(request);

      expect(result.questionFileId).toBe('mock-file-uuid');
      expect(result.orgId).toBe('org-123');
      expect(result.projectId).toBe('proj-456');
      expect(result.oppId).toBe('opp-789');
      expect(result.status).toBe('UPLOADED');
      expect(result.originalFileName).toBe('rfp.pdf');
      expect(result.fileKey).toBe('s3/rfp.pdf');
      expect(result.mimeType).toBe('application/pdf');
    });

    it('writes to DynamoDB with correct PK and SK', async () => {
      mockSend.mockResolvedValue({});

      const request: CreateQuestionFileRequest = {
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
      };

      await createQuestionFile(request);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
            Item: expect.objectContaining({
              partition_key: 'QUESTION_FILE',
              sort_key: 'proj-456#opp-789#mock-file-uuid',
              questionFileId: 'mock-file-uuid',
              status: 'UPLOADED',
            }),
          }),
        }),
      );
    });

    it('sets sourceDocumentId when provided', async () => {
      mockSend.mockResolvedValue({});

      const request: CreateQuestionFileRequest = {
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
        sourceDocumentId: 'doc-abc',
      };

      await createQuestionFile(request);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              sourceDocumentId: 'doc-abc',
            }),
          }),
        }),
      );
    });

    it('sets sourceDocumentId to null when not provided', async () => {
      mockSend.mockResolvedValue({});

      const request: CreateQuestionFileRequest = {
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
      };

      await createQuestionFile(request);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              sourceDocumentId: null,
            }),
          }),
        }),
      );
    });
  });

  // ─── baseHandler (HTTP layer) ─────────────────────────────────────────────────

  describe('baseHandler', () => {
    const makeEvent = (body: unknown): AuthedEvent =>
      ({
        body: JSON.stringify(body),
        auth: { userId: 'user-001', orgId: 'org-123', claims: {} },
        requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
        headers: {},
        queryStringParameters: {},
      }) as unknown as AuthedEvent;

    it('returns 201 with created question file on valid input', async () => {
      mockSend.mockResolvedValue({});

      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 201 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.questionFileId).toBe('mock-file-uuid');
      expect(body.status).toBe('UPLOADED');
    });

    it('returns 400 when body is missing', async () => {
      const event = { ...makeEvent({}), body: undefined } as unknown as AuthedEvent;

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Request body is missing');
    });

    it('returns 400 with issues when orgId is missing', async () => {
      const event = makeEvent({
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
      expect(body.issues).toBeDefined();
    });

    it('returns 400 when projectId is missing', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
    });

    it('returns 400 when oppId is missing', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
    });

    it('returns 400 when originalFileName is missing', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when fileKey is missing', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        mimeType: 'application/pdf',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when mimeType is missing', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });

    it('passes sourceDocumentId through when provided', async () => {
      mockSend.mockResolvedValue({});

      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-456',
        oppId: 'opp-789',
        originalFileName: 'rfp.pdf',
        fileKey: 's3/rfp.pdf',
        mimeType: 'application/pdf',
        sourceDocumentId: 'doc-abc',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 201 });
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              sourceDocumentId: 'doc-abc',
            }),
          }),
        }),
      );
    });
  });
});
