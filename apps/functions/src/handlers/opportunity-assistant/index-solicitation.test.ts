process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutObjectCommand: jest.fn((params) => ({ type: 'Put', params })),
}));

jest.mock('@/helpers/s3', () => ({
  streamToString: jest.fn().mockResolvedValue('x'.repeat(500)),
}));

const mockIndexSolicitationChunksBatch = jest.fn().mockResolvedValue([]);
jest.mock('@/helpers/pinecone', () => ({
  indexSolicitationChunksBatch: (...args: unknown[]) => mockIndexSolicitationChunksBatch(...args),
}));

jest.mock('@/handlers/document-pipeline-steps/chunk-document', () => ({
  chunkText: jest.fn((_text: string) => ['chunk-1-text', 'chunk-2-text']),
}));

import { baseHandler } from './index-solicitation';

const mockContext = {} as never;

describe('index-solicitation handler', () => {
  beforeEach(() => {
    mockS3Send.mockReset();
    mockIndexSolicitationChunksBatch.mockClear();
  });

  const validEvent = {
    orgId: 'org-123',
    opportunityId: 'opp-456',
    projectId: 'proj-789',
    questionFileId: 'qf-1',
    fileName: 'rfp.pdf',
    textFileKey: 'text/proj-789/opp-456/qf-1.txt',
  };

  it('skips indexing when orgId is missing', async () => {
    const result = await baseHandler({ ...validEvent, orgId: '' }, mockContext);

    expect(result).toMatchObject({ success: true, chunksIndexed: 0 });
    expect(mockIndexSolicitationChunksBatch).not.toHaveBeenCalled();
  });

  it('skips indexing when opportunityId is missing', async () => {
    const result = await baseHandler({ ...validEvent, opportunityId: '' }, mockContext);

    expect(result.chunksIndexed).toBe(0);
    expect(mockIndexSolicitationChunksBatch).not.toHaveBeenCalled();
  });

  it('skips indexing when textFileKey is missing', async () => {
    const result = await baseHandler({ ...validEvent, textFileKey: '' }, mockContext);

    expect(result.chunksIndexed).toBe(0);
    expect(mockIndexSolicitationChunksBatch).not.toHaveBeenCalled();
  });

  it('forwards orgId and opportunityId to indexSolicitationChunksBatch on the happy path', async () => {
    mockS3Send.mockResolvedValueOnce({ Body: {} });
    mockS3Send.mockResolvedValue({});

    const result = await baseHandler(validEvent, mockContext);

    expect(mockIndexSolicitationChunksBatch).toHaveBeenCalledTimes(1);
    const [orgIdArg, oppIdArg, chunksArg] = mockIndexSolicitationChunksBatch.mock.calls[0];
    expect(orgIdArg).toBe('org-123');
    expect(oppIdArg).toBe('opp-456');
    expect(chunksArg).toHaveLength(2);
    expect(result.chunksIndexed).toBe(2);
  });
});
