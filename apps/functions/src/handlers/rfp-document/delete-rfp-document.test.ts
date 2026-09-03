/**
 * delete-rfp-document.test.ts
 *
 * The delete path fans out cleanup across DynamoDB (soft-delete), S3, approvals,
 * AI chat, and — the behaviour these tests pin — Google Drive. Every side cleanup
 * is best-effort: a Drive/S3/approval failure must never turn a delete into a 500,
 * or the record and its content would be orphaned with no way to retry from the UI.
 */

// Mock middy before importing the handler.
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

jest.mock('@/helpers/env', () => ({
  requireEnv: jest.fn(() => 'test-bucket'),
}));

// ─── Collaborators ───────────────────────────────────────────────────────────

const mockGetRFPDocument = jest.fn();
const mockSoftDelete = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  getRFPDocument: (...args: unknown[]) => mockGetRFPDocument(...args),
  softDeleteRFPDocument: (...args: unknown[]) => mockSoftDelete(...args),
}));

const mockDeleteFromDrive = jest.fn();
jest.mock('@/helpers/google-drive-document-sync', () => ({
  deleteDocumentFromDriveIfConfigured: (...args: unknown[]) => mockDeleteFromDrive(...args),
}));

const mockDeleteS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  deleteS3ObjectsFromKeys: (...args: unknown[]) => mockDeleteS3(...args),
}));

const mockListApprovals = jest.fn();
jest.mock('@/helpers/document-approval', () => ({
  listApprovalsByDocument: (...args: unknown[]) => mockListApprovals(...args),
}));

const mockDeleteItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  deleteItem: (...args: unknown[]) => mockDeleteItem(...args),
}));

const mockDeleteChat = jest.fn();
jest.mock('@/helpers/ai-chat', () => ({
  deleteAllChatMessages: (...args: unknown[]) => mockDeleteChat(...args),
}));

jest.mock('@/constants/document-approval', () => ({
  DOCUMENT_APPROVAL_PK: 'DOCUMENT_APPROVAL',
}));

const mockGetOrgId = jest.fn();
const mockGetUserId = jest.fn();
jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({
    statusCode,
    body: JSON.stringify(body),
  }),
  getOrgId: (...args: unknown[]) => mockGetOrgId(...args),
  getUserId: (...args: unknown[]) => mockGetUserId(...args),
}));

import { baseHandler } from './delete-rfp-document';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const ORG = 'org-1';
const USER = 'user-1';

const makeEvent = (): AuthedEvent =>
  ({
    body: JSON.stringify({
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      documentId: 'doc-1',
    }),
    queryStringParameters: null,
  }) as unknown as AuthedEvent;

const existingDoc = (overrides: Record<string, unknown> = {}) => ({
  orgId: ORG,
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  documentId: 'doc-1',
  fileKey: 'orgs/org-1/doc-1/file.docx',
  htmlContentKey: 'orgs/org-1/doc-1/content.html',
  googleDriveFileId: 'gdrive-file-1',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOrgId.mockReturnValue(ORG);
  mockGetUserId.mockReturnValue(USER);
  mockGetRFPDocument.mockResolvedValue(existingDoc());
  mockListApprovals.mockResolvedValue([]);
  mockDeleteChat.mockResolvedValue({ deleted: 0 });
  mockSoftDelete.mockResolvedValue(undefined);
  mockDeleteS3.mockResolvedValue({ deleted: 2, failed: 0, skipped: 0 });
  mockDeleteFromDrive.mockResolvedValue(undefined);
});

describe('delete-rfp-document — Drive cleanup', () => {
  it('trashes the linked Drive file on delete', async () => {
    const res = (await baseHandler(makeEvent())) as { statusCode: number };

    expect(res.statusCode).toBe(200);
    expect(mockSoftDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteFromDrive).toHaveBeenCalledWith({
      orgId: ORG,
      googleDriveFileId: 'gdrive-file-1',
    });
  });

  it('still passes an undefined fileId through when the document was never synced', async () => {
    mockGetRFPDocument.mockResolvedValue(existingDoc({ googleDriveFileId: undefined }));

    const res = (await baseHandler(makeEvent())) as { statusCode: number };

    expect(res.statusCode).toBe(200);
    // The helper itself no-ops on a falsy id; the handler always delegates.
    expect(mockDeleteFromDrive).toHaveBeenCalledWith({
      orgId: ORG,
      googleDriveFileId: undefined,
    });
  });

  it('runs Drive cleanup after the record is soft-deleted', async () => {
    // Ordering matters: the DynamoDB soft-delete is the authoritative delete, so it
    // must land before the best-effort Drive cleanup. If Drive ran first and the
    // soft-delete then failed, the app would still show a doc whose Drive file is
    // gone. deleteDocumentFromDriveIfConfigured swallows its own errors (covered in
    // the helper's tests), so the handler always returns 200 on the happy path.
    const order: string[] = [];
    mockSoftDelete.mockImplementation(async () => {
      order.push('soft-delete');
    });
    mockDeleteFromDrive.mockImplementation(async () => {
      order.push('drive');
    });

    const res = (await baseHandler(makeEvent())) as { statusCode: number };

    expect(res.statusCode).toBe(200);
    expect(order).toEqual(['soft-delete', 'drive']);
  });
});

describe('delete-rfp-document — guards', () => {
  it('404s a missing document without touching Drive', async () => {
    mockGetRFPDocument.mockResolvedValue(null);

    const res = (await baseHandler(makeEvent())) as { statusCode: number };

    expect(res.statusCode).toBe(404);
    expect(mockDeleteFromDrive).not.toHaveBeenCalled();
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it('403s a cross-org document without touching Drive', async () => {
    mockGetRFPDocument.mockResolvedValue(existingDoc({ orgId: 'other-org' }));

    const res = (await baseHandler(makeEvent())) as { statusCode: number };

    expect(res.statusCode).toBe(403);
    expect(mockDeleteFromDrive).not.toHaveBeenCalled();
  });
});
