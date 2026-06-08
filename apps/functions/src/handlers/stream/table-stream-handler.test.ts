import type { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const mockArchive = jest.fn();
jest.mock('@/helpers/audit-archive', () => ({
  archiveRemovedAuditLog: (...args: unknown[]) => mockArchive(...args),
}));

const mockDetect = jest.fn();
jest.mock('@/helpers/member-detection', () => ({
  detectNewMember: (...args: unknown[]) => mockDetect(...args),
}));

import { handler } from './table-stream-handler';

type StreamHandler = (event: DynamoDBStreamEvent) => Promise<{ batchItemFailures: { itemIdentifier: string }[] }>;
const invoke = handler as unknown as StreamHandler;

const record = (eventName: string, sequenceNumber: string): DynamoDBRecord => ({
  eventName,
  dynamodb: { SequenceNumber: sequenceNumber },
} as unknown as DynamoDBRecord);

beforeEach(() => {
  jest.clearAllMocks();
  mockArchive.mockReset();
  mockDetect.mockReset();
});

describe('table-stream-handler dispatcher', () => {
  it('routes REMOVE records to archiveRemovedAuditLog', async () => {
    const res = await invoke({ Records: [record('REMOVE', '1')] });
    expect(mockArchive).toHaveBeenCalledTimes(1);
    expect(mockDetect).not.toHaveBeenCalled();
    expect(res.batchItemFailures).toEqual([]);
  });

  it('routes INSERT records to detectNewMember', async () => {
    const res = await invoke({ Records: [record('INSERT', '2')] });
    expect(mockDetect).toHaveBeenCalledTimes(1);
    expect(mockArchive).not.toHaveBeenCalled();
    expect(res.batchItemFailures).toEqual([]);
  });

  it('dispatches a mixed batch independently', async () => {
    await invoke({ Records: [record('REMOVE', '1'), record('INSERT', '2'), record('MODIFY', '3')] });
    expect(mockArchive).toHaveBeenCalledTimes(1);
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });

  it('reports only the failing record in batchItemFailures', async () => {
    mockArchive.mockRejectedValueOnce(new Error('archive failed'));

    const res = await invoke({ Records: [record('REMOVE', 'seq-fail'), record('INSERT', 'seq-ok')] });

    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'seq-fail' }]);
    expect(mockDetect).toHaveBeenCalledTimes(1);
  });
});
