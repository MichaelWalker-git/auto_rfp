/**
 * google-drive-folder-sharing.test.ts
 *
 * Covers the folder-sharing grant that makes a pushed Google Doc openable by the team.
 *
 * The load-bearing property is the cap: a Drive grant must never exceed what the member
 * already holds in AutoRFP. Getting that wrong hands write access to someone the app
 * itself refuses to let edit a proposal, which is a privilege-escalation path around
 * RBAC rather than a cosmetic bug.
 */

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
  PutObjectCommand: jest.fn((params) => ({ type: 'PutObject', params })),
}));

const mockListOrgMemberAccess = jest.fn();
jest.mock('@/helpers/org', () => ({
  listOrgMemberAccess: (...args: unknown[]) => mockListOrgMemberAccess(...args),
}));

// Everything below is unrelated to sharing but sits in the module's import graph.
jest.mock('@/helpers/export', () => ({
  loadDocumentHtmlForExport: jest.fn(),
  sanitizeFileName: (n: string) => n,
}));
jest.mock('@/helpers/export-docx', () => ({ htmlToDocxBuffer: jest.fn() }));
jest.mock('@/helpers/rfp-document-version', () => ({
  createVersion: jest.fn(),
  getLatestVersionNumber: jest.fn(),
  saveVersionHtml: jest.fn(),
}));
jest.mock('@/helpers/rfp-document', () => ({
  updateRFPDocumentMetadata: jest.fn(),
  uploadRFPDocumentHtml: jest.fn(),
}));
jest.mock('@/helpers/document-approval', () => ({
  cancelPendingApprovals: jest.fn(),
  listApprovalsByDocument: jest.fn(),
}));
jest.mock('@/helpers/send-notification', () => ({
  buildNotification: jest.fn(),
  sendNotification: jest.fn(),
}));
jest.mock('@/helpers/approval-links', () => ({ buildRfpDocumentReviewLink: jest.fn() }));
jest.mock('@/helpers/audit-log', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/helpers/secret', () => ({ getHmacSecret: jest.fn() }));
jest.mock('mammoth', () => ({
  __esModule: true,
  default: { convertToHtml: jest.fn(), images: { imgElement: jest.fn() } },
}));

process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { ROLE_PERMISSIONS } from '@auto-rfp/core';
import {
  shareFolderWithOrgMembers,
  resolveDocumentFolder,
} from './google-drive-document-sync';

const ORG_ID = 'org-1';
const FOLDER_ID = 'folder-abc';

/** Records what was granted to whom, so assertions read as role → Drive role. */
const grantsFrom = (mock: jest.Mock): Array<{ email: string; role: string }> =>
  mock.mock.calls.map(([arg]) => ({
    email: (arg as { requestBody: { emailAddress: string } }).requestBody.emailAddress,
    role: (arg as { requestBody: { role: string } }).requestBody.role,
  }));

const makeDrive = (permissionsCreate: jest.Mock) =>
  ({ permissions: { create: permissionsCreate } }) as unknown as Parameters<
    typeof shareFolderWithOrgMembers
  >[0]['drive'];

describe('shareFolderWithOrgMembers — access is capped by in-app permissions', () => {
  let permissionsCreate: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    permissionsCreate = jest.fn().mockResolvedValue({ data: { id: 'perm-1' } });
  });

  it('grants writer only to roles that hold proposal:edit', async () => {
    mockListOrgMemberAccess.mockResolvedValue([
      { email: 'admin@example.com', role: 'ADMIN' },
      { email: 'editor@example.com', role: 'EDITOR' },
    ]);

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    expect(grantsFrom(permissionsCreate)).toEqual([
      { email: 'admin@example.com', role: 'writer' },
      { email: 'editor@example.com', role: 'writer' },
    ]);
    expect(result).toMatchObject({ shared: 2, skipped: 0, failed: 0 });
  });

  it('grants only reader to roles that can read but not edit a proposal', async () => {
    mockListOrgMemberAccess.mockResolvedValue([
      { email: 'viewer@example.com', role: 'VIEWER' },
      { email: 'member@example.com', role: 'MEMBER' },
    ]);

    await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    // Writer here would let someone edit in Drive who cannot edit in AutoRFP, and the
    // import path would then apply those edits back into the app.
    expect(grantsFrom(permissionsCreate)).toEqual([
      { email: 'viewer@example.com', role: 'reader' },
      { email: 'member@example.com', role: 'reader' },
    ]);
  });

  it('grants BILLING reader, since it holds proposal:read but not proposal:edit', async () => {
    mockListOrgMemberAccess.mockResolvedValue([{ email: 'billing@example.com', role: 'BILLING' }]);

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    // Asserted against ROLE_PERMISSIONS rather than an assumed role list — BILLING's
    // `proposal:read` is easy to overlook when reading the roles by name.
    expect(grantsFrom(permissionsCreate)).toEqual([
      { email: 'billing@example.com', role: 'reader' },
    ]);
    expect(result).toMatchObject({ shared: 1, skipped: 0 });
  });

  it('grants nothing to a member whose role is missing or unrecognised', async () => {
    mockListOrgMemberAccess.mockResolvedValue([
      { email: 'norole@example.com' },
      { email: 'weird@example.com', role: 'SUPERUSER' },
    ]);

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    // Defaulting an unknown role to anything permissive is how a bad record becomes an
    // access grant.
    expect(permissionsCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ shared: 0, skipped: 2 });
  });
});

describe('shareFolderWithOrgMembers — the mapping tracks ROLE_PERMISSIONS', () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * Guards the invariant rather than a snapshot of today's roles: whatever core says a
   * role can do, the Drive grant must not exceed it. If someone adds `proposal:edit` to
   * VIEWER, this keeps passing (correctly, writer follows); if the derivation is replaced
   * with a hardcoded list that drifts from core, it fails.
   */
  it.each(['ADMIN', 'EDITOR', 'VIEWER', 'MEMBER', 'BILLING'] as const)(
    'grants %s exactly what its permissions allow',
    async (role) => {
      const permissions: readonly string[] = ROLE_PERMISSIONS[role] ?? [];
      const expected = permissions.includes('proposal:edit')
        ? 'writer'
        : permissions.includes('proposal:read')
          ? 'reader'
          : null;

      mockListOrgMemberAccess.mockResolvedValue([{ email: `${role}@example.com`, role }]);
      const permissionsCreate = jest.fn().mockResolvedValue({ data: { id: 'p' } });

      await shareFolderWithOrgMembers({
        drive: makeDrive(permissionsCreate),
        folderId: FOLDER_ID,
        orgId: ORG_ID,
      });

      if (expected === null) {
        expect(permissionsCreate).not.toHaveBeenCalled();
      } else {
        expect(grantsFrom(permissionsCreate)).toEqual([
          { email: `${role}@example.com`, role: expected },
        ]);
      }
    },
  );

  it('never grants writer to a role lacking proposal:edit', async () => {
    const overreaching = (['ADMIN', 'EDITOR', 'VIEWER', 'MEMBER', 'BILLING'] as const).filter(
      (role) => !(ROLE_PERMISSIONS[role] ?? []).includes('proposal:edit'),
    );
    mockListOrgMemberAccess.mockResolvedValue(
      overreaching.map((role) => ({ email: `${role}@example.com`, role })),
    );
    const permissionsCreate = jest.fn().mockResolvedValue({ data: { id: 'p' } });

    await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    expect(grantsFrom(permissionsCreate).every((g) => g.role === 'reader')).toBe(true);
  });
});

describe('shareFolderWithOrgMembers — never breaks the sync', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps going when one member cannot be granted access', async () => {
    mockListOrgMemberAccess.mockResolvedValue([
      { email: 'external@gmail.com', role: 'EDITOR' },
      { email: 'internal@example.com', role: 'EDITOR' },
    ]);
    const permissionsCreate = jest
      .fn()
      .mockRejectedValueOnce(new Error('sharing outside the domain is not allowed'))
      .mockResolvedValueOnce({ data: { id: 'perm-2' } });

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    // A Workspace policy rejecting an external address must not cost the rest of the
    // team their access.
    expect(result).toMatchObject({ shared: 1, failed: 1 });
    expect(permissionsCreate).toHaveBeenCalledTimes(2);
  });

  it('retries with a notification when Drive refuses a silent grant', async () => {
    mockListOrgMemberAccess.mockResolvedValue([{ email: 'noaccount@example.com', role: 'ADMIN' }]);
    // Verbatim shape of the real Drive 400, observed against the live API.
    const permissionsCreate = jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          'Bad Request. User message: "You are trying to invite noaccount@example.com. ' +
            'Since there is no Google account associated with this email address, you must ' +
            'check the "Notify people" box to invite this recipient."',
        ),
      )
      .mockResolvedValueOnce({ data: { id: 'perm-1' } });

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    // Without the retry these members — real ADMINs — silently get no access at all.
    expect(result).toMatchObject({ shared: 1, failed: 0 });
    expect(permissionsCreate).toHaveBeenCalledTimes(2);
    expect(permissionsCreate.mock.calls[0]![0]).toMatchObject({ sendNotificationEmail: false });
    expect(permissionsCreate.mock.calls[1]![0]).toMatchObject({ sendNotificationEmail: true });
  });

  it('does not retry a refusal a notification would not fix', async () => {
    mockListOrgMemberAccess.mockResolvedValue([{ email: 'outside@other.com', role: 'EDITOR' }]);
    const permissionsCreate = jest
      .fn()
      .mockRejectedValue(new Error('Sharing outside your organization is not allowed.'));

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    // Retrying a hard policy refusal just doubles the Drive calls and, worse, would mail
    // a person who was never going to get access.
    expect(permissionsCreate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ shared: 0, failed: 1 });
  });

  it('does not retry a duplicate-grant error with a notification', async () => {
    mockListOrgMemberAccess.mockResolvedValue([{ email: 'editor@example.com', role: 'EDITOR' }]);
    const permissionsCreate = jest
      .fn()
      .mockRejectedValue(new Error('The user already has access to this file.'));

    await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    // Emailing someone who already has access would be pure spam.
    expect(permissionsCreate).toHaveBeenCalledTimes(1);
  });

  it('counts a member as failed when even the notified retry is refused', async () => {
    mockListOrgMemberAccess.mockResolvedValue([{ email: 'noaccount@example.com', role: 'ADMIN' }]);
    const permissionsCreate = jest
      .fn()
      .mockRejectedValueOnce(
        new Error('no Google account associated with this email address, check "Notify people"'),
      )
      .mockRejectedValueOnce(new Error('still refused'));

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    expect(result).toMatchObject({ shared: 0, failed: 1 });
    expect(permissionsCreate).toHaveBeenCalledTimes(2);
  });

  it('resolves rather than throwing when the member list is unreadable', async () => {
    mockListOrgMemberAccess.mockRejectedValue(new Error('DynamoDB unavailable'));
    const permissionsCreate = jest.fn();

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    // Throwing here would fail an otherwise-successful document push.
    expect(result).toMatchObject({ shared: 0, skipped: 0, failed: 0 });
    expect(permissionsCreate).not.toHaveBeenCalled();
  });

  it('tolerates a duplicate grant, which is the expected case on re-resolve', async () => {
    mockListOrgMemberAccess.mockResolvedValue([{ email: 'editor@example.com', role: 'EDITOR' }]);
    const permissionsCreate = jest
      .fn()
      .mockRejectedValue(new Error('The user already has access to this file.'));

    const result = await shareFolderWithOrgMembers({
      drive: makeDrive(permissionsCreate),
      folderId: FOLDER_ID,
      orgId: ORG_ID,
    });

    expect(result).toMatchObject({ shared: 0, failed: 1 });
  });
});

describe('resolveDocumentFolder — shares only a newly created folder', () => {
  let filesList: jest.Mock;
  let filesCreate: jest.Mock;
  let permissionsCreate: jest.Mock;

  const makeFolderDrive = () =>
    ({
      files: { list: filesList, create: filesCreate },
      permissions: { create: permissionsCreate },
    }) as unknown as Parameters<typeof resolveDocumentFolder>[0]['drive'];

  beforeEach(() => {
    jest.clearAllMocks();
    // No existing folders, so each level is created.
    filesList = jest.fn().mockResolvedValue({ data: { files: [] } });
    filesCreate = jest.fn().mockResolvedValue({ data: { id: 'new-folder' } });
    permissionsCreate = jest.fn().mockResolvedValue({ data: { id: 'perm-1' } });
    mockListOrgMemberAccess.mockResolvedValue([{ email: 'editor@example.com', role: 'EDITOR' }]);
  });

  it('shares the folder tree it just created', async () => {
    const folderId = await resolveDocumentFolder({
      drive: makeFolderDrive(),
      doc: { documentType: 'OTHER' } as Parameters<typeof resolveDocumentFolder>[0]['doc'],
      projectId: 'proj-1',
      orgId: ORG_ID,
    });

    expect(folderId).toBe('new-folder');
    expect(permissionsCreate).toHaveBeenCalledTimes(1);
  });

  it('does not re-share when the folder id is already cached on the document', async () => {
    const folderId = await resolveDocumentFolder({
      drive: makeFolderDrive(),
      doc: { driveFolderId: 'cached-folder' } as Parameters<
        typeof resolveDocumentFolder
      >[0]['doc'],
      projectId: 'proj-1',
      orgId: ORG_ID,
    });

    // Re-granting on every push would spend a Drive call per member per push, and Drive
    // per-user rate limits are what bound the poller.
    expect(folderId).toBe('cached-folder');
    expect(permissionsCreate).not.toHaveBeenCalled();
    expect(mockListOrgMemberAccess).not.toHaveBeenCalled();
  });

  it('skips sharing entirely when no orgId is supplied', async () => {
    await resolveDocumentFolder({
      drive: makeFolderDrive(),
      doc: { documentType: 'OTHER' } as Parameters<typeof resolveDocumentFolder>[0]['doc'],
      projectId: 'proj-1',
    });

    // The opportunity-level sync shares its own root folder and opts out here.
    expect(permissionsCreate).not.toHaveBeenCalled();
  });
});
