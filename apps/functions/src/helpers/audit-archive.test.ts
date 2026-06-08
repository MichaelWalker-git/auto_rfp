import type { DynamoDBRecord } from 'aws-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((params) => ({ type: 'PutObject', params })),
}));

process.env.AUDIT_ARCHIVE_BUCKET = 'test-archive-bucket';
process.env.STAGE = 'test';

import { archiveRemovedAuditLog } from './audit-archive';

const AUDIT_LOG_PK = 'AUDIT_LOG';
const PK_NAME = 'partition_key';

const makeRecord = (item: Record<string, unknown>): DynamoDBRecord => ({
  eventName: 'REMOVE',
  dynamodb: { OldImage: marshall(item) },
} as unknown as DynamoDBRecord);

beforeEach(() => {
  jest.clearAllMocks();
  mockS3Send.mockReset();
});

describe('archiveRemovedAuditLog', () => {
  it('archives an AUDIT_LOG item to the correct date-partitioned key', async () => {
    mockS3Send.mockResolvedValueOnce({});

    await archiveRemovedAuditLog(makeRecord({
      [PK_NAME]: AUDIT_LOG_PK,
      organizationId: 'org-1',
      timestamp: '2026-03-15T10:00:00.000Z',
      logId: 'log-123',
    }));

    expect(mockS3Send).toHaveBeenCalledTimes(1);
    const { params } = mockS3Send.mock.calls[0][0];
    expect(params.Bucket).toBe('test-archive-bucket');
    expect(params.Key).toBe('audit-logs/org-1/2026/03/15/log-123.json');
    expect(params.StorageClass).toBe('GLACIER_IR');
  });

  it('ignores records without an OldImage', async () => {
    await archiveRemovedAuditLog({ eventName: 'REMOVE', dynamodb: {} } as DynamoDBRecord);
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('ignores items that are not AUDIT_LOG', async () => {
    await archiveRemovedAuditLog(makeRecord({ [PK_NAME]: 'USER', userId: 'u-1' }));
    expect(mockS3Send).not.toHaveBeenCalled();
  });

  it('rethrows when the S3 put fails', async () => {
    mockS3Send.mockRejectedValueOnce(new Error('s3 down'));

    await expect(
      archiveRemovedAuditLog(makeRecord({
        [PK_NAME]: AUDIT_LOG_PK,
        organizationId: 'org-1',
        timestamp: '2026-03-15T10:00:00.000Z',
        logId: 'log-123',
      })),
    ).rejects.toThrow('s3 down');
  });
});
