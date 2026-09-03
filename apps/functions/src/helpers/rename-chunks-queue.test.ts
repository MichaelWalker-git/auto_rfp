/**
 * Tests for the rename-chunks SQS enqueue helper (ticket 04).
 */
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSend })),
  SendMessageCommand: jest.fn((params) => ({ type: 'SendMessage', params })),
}));

import { RenameChunksJobSchema, enqueueRenameChunksJob, type RenameChunksJob } from './rename-chunks-queue';

const job: RenameChunksJob = {
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
  mockSend.mockResolvedValue({});
});

describe('RenameChunksJobSchema', () => {
  it('accepts a valid job', () => {
    const { success } = RenameChunksJobSchema.safeParse(job);
    expect(success).toBe(true);
  });

  it('rejects a non-positive chunkCount', () => {
    const { success } = RenameChunksJobSchema.safeParse({ ...job, chunkCount: 0 });
    expect(success).toBe(false);
  });

  it('rejects a missing sk', () => {
    const { sk: _sk, ...withoutSk } = job;
    const { success } = RenameChunksJobSchema.safeParse(withoutSk);
    expect(success).toBe(false);
  });

  it('rejects a missing textFileKey', () => {
    const { textFileKey: _textFileKey, ...withoutTextFileKey } = job;
    const { success } = RenameChunksJobSchema.safeParse(withoutTextFileKey);
    expect(success).toBe(false);
  });
});

describe('enqueueRenameChunksJob', () => {
  it('sends the job as JSON to the rename-chunks queue', async () => {
    await enqueueRenameChunksJob(job);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const command = mockSend.mock.calls[0][0] as { params: { QueueUrl: string; MessageBody: string } };
    expect(command.params.QueueUrl).toBe(process.env.RENAME_CHUNKS_QUEUE_URL);
    expect(JSON.parse(command.params.MessageBody)).toEqual(job);
  });

  it('propagates SQS failures to the caller', async () => {
    mockSend.mockRejectedValue(new Error('SQS unavailable'));
    await expect(enqueueRenameChunksJob(job)).rejects.toThrow('SQS unavailable');
  });
});

describe('module import safety', () => {
  it('does not throw at import time when RENAME_CHUNKS_QUEUE_URL is unset — this module is pulled in ' +
    'transitively by create-document.ts and delete-document.ts via ./document, which never configure it', () => {
    const original = process.env.RENAME_CHUNKS_QUEUE_URL;
    delete process.env.RENAME_CHUNKS_QUEUE_URL;
    jest.resetModules();

    expect(() => require('./rename-chunks-queue')).not.toThrow();

    process.env.RENAME_CHUNKS_QUEUE_URL = original;
  });
});
