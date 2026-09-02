jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));

const mockUpdateChunkDocumentNameInPinecone = jest.fn();
jest.mock('@/helpers/pinecone', () => ({
  updateChunkDocumentNameInPinecone: (...a: unknown[]) => mockUpdateChunkDocumentNameInPinecone(...a),
}));

const mockWriteAuditLog = jest.fn().mockResolvedValue(undefined);
jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: (...a: unknown[]) => mockWriteAuditLog(...a),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('test-hmac-secret'),
}));

import { baseHandler } from './rename-chunks-worker';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

const buildSQSEvent = (records: Partial<SQSRecord>[]): SQSEvent => ({
  Records: records.map((r, i) => ({
    messageId: `msg-${i}`,
    receiptHandle: `receipt-${i}`,
    body: '{}',
    attributes: {} as SQSRecord['attributes'],
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test-queue',
    awsRegion: 'us-east-1',
    ...r,
  })),
});

const job = {
  orgId: 'org-1',
  knowledgeBaseId: 'kb-1',
  id: 'doc-1',
  sk: 'KB#kb-1#DOC#doc-1',
  documentName: 'New Name.pdf',
  chunkCount: 1500,
  textFileKey: 'files/doc-1.txt',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateChunkDocumentNameInPinecone.mockResolvedValue(undefined);
});

describe('rename-chunks-worker baseHandler', () => {
  it('reconstructs chunk IDs and propagates the new documentName for a valid job', async () => {
    const result = await baseHandler(buildSQSEvent([{ body: JSON.stringify(job) }]));

    expect(mockUpdateChunkDocumentNameInPinecone).toHaveBeenCalledWith(
      'org-1',
      'KB#kb-1#DOC#doc-1',
      1500,
      'files/doc-1.txt',
      'New Name.pdf',
    );
    expect(result.batchItemFailures).toEqual([]);
  });

  it('processes multiple messages in a batch independently', async () => {
    const job2 = { ...job, id: 'doc-2', sk: 'KB#kb-1#DOC#doc-2' };

    const result = await baseHandler(
      buildSQSEvent([{ body: JSON.stringify(job) }, { body: JSON.stringify(job2) }]),
    );

    expect(mockUpdateChunkDocumentNameInPinecone).toHaveBeenCalledTimes(2);
    expect(result.batchItemFailures).toEqual([]);
  });

  it('surfaces a malformed message as a batch item failure (retry via SQS)', async () => {
    const result = await baseHandler(buildSQSEvent([{ body: JSON.stringify({ bad: true }) }]));

    expect(mockUpdateChunkDocumentNameInPinecone).not.toHaveBeenCalled();
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-0' }]);
  });

  it('surfaces a non-JSON body as a batch item failure without throwing', async () => {
    const result = await baseHandler(buildSQSEvent([{ body: 'not json at all' }]));

    expect(mockUpdateChunkDocumentNameInPinecone).not.toHaveBeenCalled();
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-0' }]);
  });

  it('surfaces a Pinecone failure as a batch item failure for SQS retry/DLQ', async () => {
    mockUpdateChunkDocumentNameInPinecone.mockRejectedValueOnce(new Error('pinecone down'));

    const result = await baseHandler(buildSQSEvent([{ body: JSON.stringify(job) }]));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-0' }]);
  });

  it('isolates a failure in one message from the rest of the batch', async () => {
    mockUpdateChunkDocumentNameInPinecone
      .mockRejectedValueOnce(new Error('pinecone down'))
      .mockResolvedValueOnce(undefined);
    const job2 = { ...job, id: 'doc-2', sk: 'KB#kb-1#DOC#doc-2' };

    const result = await baseHandler(
      buildSQSEvent([{ body: JSON.stringify(job) }, { body: JSON.stringify(job2) }]),
    );

    expect(mockUpdateChunkDocumentNameInPinecone).toHaveBeenCalledTimes(2);
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'msg-0' }]);
  });
});
