/**
 * Regression tests for Sentry issues:
 * - AUTO-RFP-3V: TypeError: (text ?? "").trim is not a function (49 occurrences!)
 * - AUTO-RFP-6F: Error: document does not exist (document deleted mid-pipeline)
 * - AUTO-RFP-6E: ValidationException: Filter Expression can only contain non-primary key attributes
 * - Document indexing validation errors
 */

// Mock AWS SDK and other dependencies before importing handler
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: jest.fn(),
  })),
  GetObjectCommand: jest.fn(),
}), { virtual: true });

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}), { virtual: true });

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({})),
}), { virtual: true });

jest.mock('@/helpers/embeddings', () => ({
  getEmbedding: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
}));

jest.mock('@/helpers/db', () => ({
  docClient: {
    send: jest.fn().mockResolvedValue({ Items: [] }),
  },
  getItem: jest.fn().mockResolvedValue({
    documentId: 'doc-123',
    name: 'Test Document',
    orgId: 'org-123',
    knowledgeBaseId: 'kb-123',
  }),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: any) => fn,
}));

jest.mock('@/helpers/pinecone', () => ({
  indexChunkToPinecone: jest.fn().mockResolvedValue('vector-id-123'),
  semanticSearchChunks: jest.fn().mockResolvedValue([]),
  deleteFromPinecone: jest.fn().mockResolvedValue(undefined),
  deleteVectorById: jest.fn().mockResolvedValue(undefined),
}));

describe('index-document Lambda - Input Validation', () => {
  // Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  const mockContext = {
    functionName: 'test',
    memoryLimitInMB: '128',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    awsRequestId: 'request-123',
    getRemainingTimeInMillis: () => 30000,
  } as any;

  it('should throw when documentId is missing', async () => {
    // Import after mocks are set up
    const { baseHandler } = await import('./index-document');
    const event = { orgId: 'org-123', knowledgeBaseId: 'kb-123', chunkKey: 'chunks/doc-123/chunk-0.txt' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'orgId, documentId and chunkKey are required'
    );
  });

  it('should throw when chunkKey is missing', async () => {
    const { baseHandler } = await import('./index-document');
    const event = { orgId: 'org-123', knowledgeBaseId: 'kb-123', documentId: 'doc-123' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'orgId, documentId and chunkKey are required'
    );
  });

  it('should throw when knowledgeBaseId is missing', async () => {
    const { baseHandler } = await import('./index-document');
    const event = { orgId: 'org-123', documentId: 'doc-123', chunkKey: 'chunks/doc-123/chunk-0.txt' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'orgId, documentId and chunkKey are required'
    );
  });

  it('should throw when multiple required fields are missing', async () => {
    const { baseHandler } = await import('./index-document');

    await expect(baseHandler({ orgId: 'org-123' }, mockContext)).rejects.toThrow(
      'orgId, documentId and chunkKey are required'
    );
  });
});

describe('index-document Lambda - Text Processing (Sentry: AUTO-RFP-3V)', () => {
  /**
   * This tests the bug where text was sometimes not a string,
   * causing "(text ?? "").trim is not a function" error.
   *
   * The fix should ensure text is always properly validated/coerced.
   */

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Set up S3 mock for tests that need S3 fallback
    // Create a mock stream that has .on() method like Node.js streams
    const { Readable } = require('stream');
    const mockStream = new Readable();
    mockStream.push('Content from S3 fallback');
    mockStream.push(null); // signals end of stream

    const { S3Client } = require('@aws-sdk/client-s3');
    S3Client.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({
        Body: mockStream,
      }),
    }));
  });

  const mockContext = {} as any;

  it('should handle text as string', async () => {
    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: 'Valid text content',
    };

    // Should not throw TypeError
    const result = await baseHandler(event, mockContext);
    expect(result.success).toBe(true);
  });

  it('should handle text as empty string', async () => {
    const { baseHandler } = await import('./index-document');

    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: '', // Empty string should trigger S3 read
    };

    // Should fall back to S3 and not throw
    const result = await baseHandler(event, mockContext);
    expect(result.success).toBe(true);
  });

  it('should handle text as null (Sentry: AUTO-RFP-3V)', async () => {
    const { baseHandler } = await import('./index-document');

    // When text is null, it should read from S3
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: null as any,
    };

    // Should not throw "(text ?? "").trim is not a function"
    // because the code checks typeof event.text === 'string'
    const result = await baseHandler(event, mockContext);
    expect(result.success).toBe(true);
  });

  it('should handle text as undefined', async () => {
    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: undefined,
    };

    // Should fall back to S3 read and not throw
    const result = await baseHandler(event, mockContext);
    expect(result.success).toBe(true);
  });

  it('should handle text as array (edge case that caused Sentry error)', async () => {
    const { baseHandler } = await import('./index-document');

    // This is the actual bug - text was sometimes an array
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: ['array', 'of', 'strings'] as any, // This would cause .trim() to fail
    };

    // The current code: typeof event.text === 'string' && event.text.trim().length > 0
    // should correctly handle this by falling back to S3
    // typeof ['a','b'] === 'object', not 'string'
    const result = await baseHandler(event, mockContext);
    expect(result.success).toBe(true);
  });

  it('should handle text as object (edge case)', async () => {
    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: { content: 'text' } as any,
    };

    // typeof {} === 'object', so should fall back to S3
    const result = await baseHandler(event, mockContext);
    expect(result.success).toBe(true);
  });

  it('should handle text as number (edge case)', async () => {
    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: 12345 as any,
    };

    // typeof 12345 === 'number', so should fall back to S3
    const result = await baseHandler(event, mockContext);
    expect(result.success).toBe(true);
  });
});

describe('index-document Lambda - S3 Read Fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  const mockContext = {} as any;

  it('should throw when S3 returns empty body', async () => {
    // Mock S3 to return empty body
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn(() => ({
        send: jest.fn().mockResolvedValue({ Body: null }),
      })),
      GetObjectCommand: jest.fn(),
    }));

    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
    };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      /S3 GetObject returned empty body/
    );
  });
});

describe('index-document Lambda - Chunk Indexing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  const mockContext = {} as any;

  it('should mark document as indexed on last chunk', async () => {
    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-4.txt',
      text: 'Final chunk content',
      index: 5,
      totalChunks: 5, // Last chunk
    };

    const result = await baseHandler(event, mockContext);
    expect(result.markedIndexed).toBe(true);
  });

  it('should not mark document as indexed on non-last chunk', async () => {
    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-2.txt',
      text: 'Middle chunk content',
      index: 3,
      totalChunks: 5,
    };

    const result = await baseHandler(event, mockContext);
    expect(result.markedIndexed).toBe(false);
  });

  it('should not mark indexed when index/totalChunks not provided', async () => {
    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: 'Chunk content',
    };

    const result = await baseHandler(event, mockContext);
    expect(result.markedIndexed).toBe(false);
  });
});

describe('index-document Lambda - Document Deleted Mid-Pipeline (Sentry: AUTO-RFP-6F)', () => {
  /**
   * Tests for graceful handling when a document is deleted while the indexing
   * pipeline is still running. Instead of throwing an error, the handler should
   * return a "skipped" result.
   */

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Set up S3 mock for tests
    const { Readable } = require('stream');
    const mockStream = new Readable();
    mockStream.push('Content from S3');
    mockStream.push(null);

    const { S3Client } = require('@aws-sdk/client-s3');
    S3Client.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({
        Body: mockStream,
      }),
    }));
  });

  const mockContext = {} as any;

  it('should return skipped result when document does not exist (AUTO-RFP-6F)', async () => {
    // Mock getItem to return null (document deleted)
    jest.doMock('../helpers/db', () => ({
      docClient: {
        send: jest.fn().mockResolvedValue({ Items: [] }),
      },
      getItem: jest.fn().mockResolvedValue(null), // Document not found
    }));

    const { baseHandler } = await import('./index-document');
    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'deleted-doc-123',
      chunkKey: 'chunks/deleted-doc-123/chunk-0.txt',
      text: 'Some text content',
    };

    // Should NOT throw an error anymore
    const result = await baseHandler(event, mockContext);

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('document_deleted');
    expect(result.documentId).toBe('deleted-doc-123');
    expect(result.markedIndexed).toBe(false);
  });

  it('should not call indexChunkToPinecone when document is deleted', async () => {
    // Mock getItem to return null
    jest.doMock('../helpers/db', () => ({
      docClient: {
        send: jest.fn().mockResolvedValue({ Items: [] }),
      },
      getItem: jest.fn().mockResolvedValue(null),
    }));

    const pinecone = require('@/helpers/pinecone');
    const { baseHandler } = await import('./index-document');

    const event = {
      orgId: 'org-123',
      knowledgeBaseId: 'kb-123',
      documentId: 'deleted-doc-123',
      chunkKey: 'chunks/deleted-doc-123/chunk-0.txt',
      text: 'Some text content',
    };

    await baseHandler(event, mockContext);

    // Pinecone should NOT be called when document doesn't exist
    expect(pinecone.indexChunkToPinecone).not.toHaveBeenCalled();
  });
});
