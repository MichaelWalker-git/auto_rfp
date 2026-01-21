/**
 * Regression tests for Sentry issues:
 * - AUTO-RFP-3V: TypeError: (text ?? "").trim is not a function (49 occurrences!)
 * - Document indexing validation errors
 */

// Mock credential provider before other imports to avoid dynamic import issues
jest.mock('@aws-sdk/credential-provider-node', () => ({
  defaultProvider: jest.fn(() => () =>
    Promise.resolve({
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      sessionToken: 'test-session-token',
    })
  ),
}));

// Mock AWS SDK and other dependencies before importing handler
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: jest.fn(),
  })),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn(() => ({})),
}));

jest.mock('../helpers/embeddings', () => ({
  getEmbedding: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
}));

jest.mock('../helpers/db', () => ({
  docClient: {
    send: jest.fn().mockResolvedValue({ Items: [] }),
  },
}));

jest.mock('../sentry-lambda', () => ({
  withSentryLambda: (fn: any) => fn,
}));

// Mock https for OpenSearch calls
jest.mock('https', () => ({
  request: jest.fn((options, callback) => {
    const mockRes = {
      statusCode: 200,
      statusMessage: 'OK',
      on: jest.fn((event, handler) => {
        if (event === 'data') {
          handler(Buffer.from('{"_id":"mock-id"}'));
        }
        if (event === 'end') {
          handler();
        }
        return mockRes;
      }),
    };
    callback(mockRes);
    return {
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
  }),
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
    const event = { chunkKey: 'chunks/doc-123/chunk-0.txt' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'documentId and chunkKey are required'
    );
  });

  it('should throw when chunkKey is missing', async () => {
    const { baseHandler } = await import('./index-document');
    const event = { documentId: 'doc-123' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'documentId and chunkKey are required'
    );
  });

  it('should throw when both documentId and chunkKey are missing', async () => {
    const { baseHandler } = await import('./index-document');

    await expect(baseHandler({}, mockContext)).rejects.toThrow(
      'documentId and chunkKey are required'
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
  });

  const mockContext = {} as any;

  it('should handle text as string', async () => {
    const { baseHandler } = await import('./index-document');
    const event = {
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

    // Mock S3 to return content when text is empty
    const { S3Client } = require('@aws-sdk/client-s3');
    S3Client.mockImplementation(() => ({
      send: jest.fn().mockResolvedValue({
        Body: {
          transformToString: () => Promise.resolve('Content from S3'),
        },
      }),
    }));

    const event = {
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
      documentId: 'doc-123',
      chunkKey: 'chunks/doc-123/chunk-0.txt',
      text: 'Chunk content',
    };

    const result = await baseHandler(event, mockContext);
    expect(result.markedIndexed).toBe(false);
  });
});
