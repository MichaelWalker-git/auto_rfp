/**
 * poll-google-drive-changes.test.ts
 *
 * The headline property is isolation: EventBridge retries a failed invocation, so a
 * single broken org or document must never take down a pass. These tests pin that,
 * plus the two things that make the pass affordable and safe — orgs without Drive
 * credentials are skipped *before* the index is queried, and the poller never passes
 * `acceptApprovedOverride`.
 */

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
  PutObjectCommand: jest.fn((params) => ({ type: 'PutObject', params })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const mockQueryByIndex = jest.fn();
jest.mock('@/helpers/db', () => ({
  queryByIndex: (...args: unknown[]) => mockQueryByIndex(...args),
  getItem: jest.fn(),
  updateItem: jest.fn(),
  isConditionalCheckFailed: jest.fn(() => false),
  docClient: { send: jest.fn() },
}));

const mockListAllOrgIds = jest.fn();
jest.mock('@/helpers/org', () => ({
  listAllOrgIds: (...args: unknown[]) => mockListAllOrgIds(...args),
}));

const mockGetDriveClientForOrg = jest.fn();
jest.mock('@/helpers/google-drive-client', () => ({
  getDriveClientForOrg: (...args: unknown[]) => mockGetDriveClientForOrg(...args),
}));

const mockPull = jest.fn();
const mockMarkFailed = jest.fn();
jest.mock('@/helpers/google-drive-document-sync', () => ({
  DRIVE_SYNC_INDEX_NAME: 'byDriveSync',
  DRIVE_SYNC_PK_ATTRIBUTE: 'driveSyncPk',
  DRIVE_SYNC_SK_ATTRIBUTE: 'driveSyncSk',
  pullDocumentFromDriveIfChanged: (...args: unknown[]) => mockPull(...args),
  markDriveSyncFailed: (...args: unknown[]) => mockMarkFailed(...args),
}));

const mockWriteAuditLog = jest.fn();
jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('test-secret'),
}));

process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './poll-google-drive-changes';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

/** An event with no `detail`, the shape EventBridge sends for a bare schedule. */
type PollEventArg = Parameters<typeof baseHandler>[0];

const makeEvent = (detail?: Record<string, unknown>): PollEventArg =>
  ({
    'detail-type': 'gdrive.pollChanges',
    source: 'auto-rfp',
    detail,
  }) as unknown as PollEventArg;

const link = (id: string, overrides: Record<string, unknown> = {}) => ({
  partition_key: 'RFP_DOCUMENT',
  sort_key: `proj-1#opp-1#${id}`,
  documentId: id,
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  orgId: ORG_A,
  name: `Doc ${id}`,
  googleDriveFileId: `file-${id}`,
  driveModifiedTime: '2026-08-17T09:00:00.000Z',
  ...overrides,
});

describe('poll-google-drive-changes handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockListAllOrgIds.mockResolvedValue([ORG_A]);
    mockGetDriveClientForOrg.mockResolvedValue({
      drive: { files: {} },
      delegateEmail: 'owner@example.com',
    });
    mockQueryByIndex.mockResolvedValue([link('doc-1')]);
    mockPull.mockResolvedValue({ changed: true, versionNumber: 5 });
    mockMarkFailed.mockResolvedValue(undefined);
    mockWriteAuditLog.mockResolvedValue({});
  });

  describe('org selection', () => {
    it('skips an org with no Drive credential without querying the index', async () => {
      mockGetDriveClientForOrg.mockResolvedValue(null);

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ ok: true });
      expect(result.totals).toMatchObject({ skipped: 1, imported: 0 });
      // The point of the ordering: an unconfigured org costs a secret miss, not a query.
      expect(mockQueryByIndex).not.toHaveBeenCalled();
      expect(mockPull).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('polls only the requested org when detail.orgId is set', async () => {
      await baseHandler(makeEvent({ orgId: ORG_B }));

      expect(mockListAllOrgIds).not.toHaveBeenCalled();
      expect(mockGetDriveClientForOrg).toHaveBeenCalledTimes(1);
      expect(mockGetDriveClientForOrg).toHaveBeenCalledWith(ORG_B);
    });

    it('queries the sparse byDriveSync index by orgId', async () => {
      await baseHandler(makeEvent());

      expect(mockQueryByIndex).toHaveBeenCalledWith('byDriveSync', 'driveSyncPk', ORG_A);
    });

    it('returns ok:false rather than throwing when the org list is unreadable', async () => {
      mockListAllOrgIds.mockRejectedValue(new Error('DynamoDB down'));

      const result = await baseHandler(makeEvent());

      // Throwing would earn an EventBridge retry of the whole pass.
      expect(result).toMatchObject({ ok: false, orgCount: 0 });
      expect(mockPull).not.toHaveBeenCalled();
    });
  });

  describe('document filtering', () => {
    it('ignores soft-deleted and unlinked rows left behind in the index', async () => {
      mockQueryByIndex.mockResolvedValue([
        link('doc-1'),
        link('doc-deleted', { deletedAt: '2026-01-01T00:00:00.000Z' }),
        link('doc-unlinked', { googleDriveFileId: undefined }),
      ]);

      const result = await baseHandler(makeEvent());

      expect(mockPull).toHaveBeenCalledTimes(1);
      expect(result.totals.linked).toBe(1);
    });

    it('narrows to one document when detail.documentId is set', async () => {
      mockQueryByIndex.mockResolvedValue([link('doc-1'), link('doc-2')]);

      await baseHandler(makeEvent({ documentId: 'doc-2' }));

      expect(mockPull).toHaveBeenCalledTimes(1);
      expect(mockPull.mock.calls[0]![0]).toMatchObject({ documentId: 'doc-2' });
    });

    it('counts a malformed link as failed instead of calling the importer', async () => {
      mockQueryByIndex.mockResolvedValue([link('doc-1', { projectId: undefined })]);

      const result = await baseHandler(makeEvent());

      expect(mockPull).not.toHaveBeenCalled();
      expect(result.totals.failed).toBe(1);
    });
  });

  describe('importing', () => {
    it('never asks the importer to override an approval', async () => {
      await baseHandler(makeEvent());

      const [args] = mockPull.mock.calls[0] as [Record<string, unknown>];
      // Reopening an approval is a named user's decision; a schedule cannot make it.
      expect(args.acceptApprovedOverride).toBeUndefined();
      expect(args.actorUserId).toBeUndefined();
    });

    it('tallies imported, blocked, and unchanged separately', async () => {
      mockQueryByIndex.mockResolvedValue([link('doc-1'), link('doc-2'), link('doc-3')]);
      mockPull
        .mockResolvedValueOnce({ changed: true, versionNumber: 5 })
        .mockResolvedValueOnce({ changed: false, blocked: true, reason: 'approved' })
        .mockResolvedValueOnce({ changed: false });

      const result = await baseHandler(makeEvent());

      expect(result.totals).toMatchObject({ linked: 3, imported: 1, blocked: 1, unchanged: 1, failed: 0 });
    });

    it('imports the rest of the org after one document throws', async () => {
      mockQueryByIndex.mockResolvedValue([link('doc-1'), link('doc-2')]);
      mockPull
        .mockRejectedValueOnce(new Error('Drive 500'))
        .mockResolvedValueOnce({ changed: true, versionNumber: 2 });

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ ok: true });
      expect(result.totals).toMatchObject({ imported: 1, failed: 1 });
      expect(mockMarkFailed).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: 'doc-1', message: 'Drive 500' }),
      );
    });

    it('polls the remaining orgs after one org fails outright', async () => {
      mockListAllOrgIds.mockResolvedValue([ORG_A, ORG_B]);
      mockQueryByIndex
        .mockRejectedValueOnce(new Error('index unavailable'))
        .mockResolvedValueOnce([link('doc-2')]);

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ ok: true, orgCount: 2 });
      expect(result.totals).toMatchObject({ errored: 1, imported: 1 });
    });

    it('records a failed org in the audit trail', async () => {
      mockQueryByIndex.mockRejectedValue(new Error('index unavailable'));

      await baseHandler(makeEvent());

      const [payload] = mockWriteAuditLog.mock.calls[0] as [Record<string, unknown>];
      expect(payload).toMatchObject({
        action: 'INTEGRATION_SYNC_FAILED',
        result: 'failure',
        userId: 'system',
        organizationId: ORG_A,
        errorMessage: 'index unavailable',
      });
    });

    it('does not audit a pass where nothing happened', async () => {
      mockPull.mockResolvedValue({ changed: false });

      await baseHandler(makeEvent());

      // Every 15 minutes forever, a "nothing changed" entry would bury the trail.
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('dry run', () => {
    it('counts links without importing or writing anything', async () => {
      mockQueryByIndex.mockResolvedValue([link('doc-1'), link('doc-2')]);

      const result = await baseHandler(makeEvent({ dryRun: true }));

      expect(result).toMatchObject({ ok: true, dryRun: true });
      expect(result.totals).toMatchObject({ linked: 2, imported: 0 });
      expect(mockPull).not.toHaveBeenCalled();
      expect(mockMarkFailed).not.toHaveBeenCalled();
      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });
  });
});
