// Mock uuid (ESM compatibility)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

// Mock mammoth
jest.mock('mammoth', () => ({
  extractRawText: jest.fn(),
}));

// Mock S3 client — use var so it is hoisted along with jest.mock
// eslint-disable-next-line no-var
var mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
  PutObjectCommand: jest.fn((params) => ({ type: 'PutObject', params })),
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

import { baseHandler } from './docx-processing';
import * as mammoth from 'mammoth';
import type { Context } from 'aws-lambda';

const mockMammoth = mammoth as jest.Mocked<typeof mammoth>;
const mockCtx = {} as Context;

describe('docx-processing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockS3Send.mockReset();
  });

  const makeReadableStream = (content: string) => {
    const { Readable } = require('stream');
    const stream = new Readable();
    stream.push(Buffer.from(content));
    stream.push(null);
    return stream;
  };

  it('extracts text from DOCX and returns result', async () => {
    // S3 GetObject → returns stream
    mockS3Send.mockResolvedValueOnce({ Body: makeReadableStream('binary-docx-content') });
    // mammoth extractRawText → returns text
    mockMammoth.extractRawText.mockResolvedValueOnce({ value: 'Extracted question text', messages: [] });
    // S3 PutObject → success
    mockS3Send.mockResolvedValueOnce({});
    // updateItem (DynamoDB) → success
    mockSend.mockResolvedValueOnce({});

    const result = await baseHandler(
      {
        orgId: 'org-1',
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        fileKey: 'uploads/rfp.docx',
        bucket: 'test-bucket',
      },
      mockCtx,
    );

    expect(result).toEqual({
      orgId: 'org-1',
      documentId: 'doc-1',
      knowledgeBaseId: 'kb-1',
      status: 'TEXT_EXTRACTED',
      bucket: 'test-bucket',
      txtKey: 'uploads/rfp.txt',
      textLength: 'Extracted question text'.length,
    });
  });

  it('builds txt key correctly for various file extensions', async () => {
    mockS3Send.mockResolvedValueOnce({ Body: makeReadableStream('content') });
    mockMammoth.extractRawText.mockResolvedValueOnce({ value: 'Some text', messages: [] });
    mockS3Send.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const result = await baseHandler(
      {
        orgId: 'org-1',
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        fileKey: 'path/to/document.docx',
        bucket: 'test-bucket',
      },
      mockCtx,
    );

    expect(result.txtKey).toBe('path/to/document.txt');
  });

  it('strips query string from fileKey when building txtKey', async () => {
    mockS3Send.mockResolvedValueOnce({ Body: makeReadableStream('content') });
    mockMammoth.extractRawText.mockResolvedValueOnce({ value: 'Some text', messages: [] });
    mockS3Send.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const result = await baseHandler(
      {
        orgId: 'org-1',
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        fileKey: 'uploads/rfp.docx?version=1',
        bucket: 'test-bucket',
      },
      mockCtx,
    );

    expect(result.txtKey).toBe('uploads/rfp.txt');
  });

  it('falls back to DynamoDB fileKey when not in event', async () => {
    // getItem → returns document with fileKey
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'DOCUMENT',
        sort_key: 'kb-1#doc-1',
        fileKey: 'uploads/from-dynamo.docx',
      },
    });
    mockS3Send.mockResolvedValueOnce({ Body: makeReadableStream('content') });
    mockMammoth.extractRawText.mockResolvedValueOnce({ value: 'Text from dynamo file', messages: [] });
    mockS3Send.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const result = await baseHandler(
      {
        orgId: 'org-1',
        knowledgeBaseId: 'kb-1',
        documentId: 'doc-1',
        bucket: 'test-bucket',
        // no fileKey
      },
      mockCtx,
    );

    expect(result.txtKey).toBe('uploads/from-dynamo.txt');
  });

  it('throws when documentId is missing', async () => {
    await expect(
      baseHandler({ orgId: 'org-1', knowledgeBaseId: 'kb-1' }, mockCtx),
    ).rejects.toThrow('documentId is required');
  });

  it('throws when extracted text is empty', async () => {
    mockS3Send.mockResolvedValueOnce({ Body: makeReadableStream('content') });
    mockMammoth.extractRawText.mockResolvedValueOnce({ value: '   ', messages: [] });

    await expect(
      baseHandler(
        { orgId: 'org-1', knowledgeBaseId: 'kb-1', documentId: 'doc-1', fileKey: 'rfp.docx', bucket: 'test-bucket' },
        mockCtx,
      ),
    ).rejects.toThrow('DOCX extracted text is empty');
  });

  it('throws when DynamoDB has no fileKey for document', async () => {
    mockSend.mockResolvedValueOnce({ Item: { partition_key: 'DOCUMENT', sort_key: 'kb-1#doc-1' } });

    await expect(
      baseHandler(
        { orgId: 'org-1', knowledgeBaseId: 'kb-1', documentId: 'doc-1', bucket: 'test-bucket' },
        mockCtx,
      ),
    ).rejects.toThrow('Document doc-1 has no fileKey in DynamoDB');
  });

  it('continues even if DynamoDB update fails', async () => {
    mockS3Send.mockResolvedValueOnce({ Body: makeReadableStream('content') });
    mockMammoth.extractRawText.mockResolvedValueOnce({ value: 'Some text', messages: [] });
    mockS3Send.mockResolvedValueOnce({});
    // updateItem throws
    mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

    // Should not throw — DynamoDB update failure is swallowed
    const result = await baseHandler(
      { orgId: 'org-1', knowledgeBaseId: 'kb-1', documentId: 'doc-1', fileKey: 'rfp.docx', bucket: 'test-bucket' },
      mockCtx,
    );

    expect(result.status).toBe('TEXT_EXTRACTED');
  });

  it('uses DOCUMENTS_BUCKET env var when bucket not in event', async () => {
    mockS3Send.mockResolvedValueOnce({ Body: makeReadableStream('content') });
    mockMammoth.extractRawText.mockResolvedValueOnce({ value: 'Some text', messages: [] });
    mockS3Send.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const result = await baseHandler(
      { orgId: 'org-1', knowledgeBaseId: 'kb-1', documentId: 'doc-1', fileKey: 'rfp.docx' },
      mockCtx,
    );

    expect(result.bucket).toBe('test-bucket'); // from jest.setup.env.js
  });
});
