jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({ before: jest.fn() }),
  orgMembershipMiddleware: () => ({ before: jest.fn() }),
  requirePermission: () => ({ before: jest.fn() }),
  httpErrorMiddleware: () => ({ onError: jest.fn() }),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({ after: jest.fn() }),
  setAuditContext: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

// Keep the real DuplicateDocumentNameError/DocumentNotFoundError classes (needed for
// `instanceof` checks in the handler) but mock only `updateDocument` itself.
jest.mock('@/helpers/document', () => {
  const actual = jest.requireActual('@/helpers/document');
  return {
    ...actual,
    updateDocument: jest.fn(),
  };
});

import { baseHandler } from './edit-document';
import * as documentHelpers from '@/helpers/document';
import { DocumentNotFoundError, DuplicateDocumentNameError } from '@/helpers/document';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { DocumentItem } from '@auto-rfp/core';

const mockUpdateDocument = documentHelpers.updateDocument as jest.MockedFunction<
  typeof documentHelpers.updateDocument
>;

const makeEvent = (body: unknown): AuthedEvent =>
  ({ body: JSON.stringify(body) } as unknown as AuthedEvent);

const makeDoc = (overrides: Partial<DocumentItem> = {}): DocumentItem => ({
  id: 'doc-1',
  knowledgeBaseId: 'kb-1',
  name: 'New Name.pdf',
  fileKey: 'files/doc-1.pdf',
  textFileKey: 'files/doc-1.txt',
  indexStatus: 'INDEXED',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('edit-document baseHandler', () => {
  it('renames a document and returns 200 (happy path)', async () => {
    mockUpdateDocument.mockResolvedValue({ document: makeDoc(), hasNameChanged: true });

    const res = (await baseHandler(
      makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', orgId: 'org-1', name: 'New Name.pdf' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? '{}').name).toBe('New Name.pdf');
  });

  it('rejects an empty name with 400 before calling the helper', async () => {
    const res = (await baseHandler(
      makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: '' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only name with 400', async () => {
    const res = (await baseHandler(
      makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: '   ' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('rejects a name over 255 characters with 400', async () => {
    const res = (await baseHandler(
      makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: 'a'.repeat(256) }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(mockUpdateDocument).not.toHaveBeenCalled();
  });

  it('returns 409 with the conflict message when the helper reports a duplicate name', async () => {
    mockUpdateDocument.mockRejectedValue(new DuplicateDocumentNameError());

    const res = (await baseHandler(
      makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: 'Dup.pdf' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body ?? '{}').message).toBe(
      'A document with this name already exists in this knowledge base.',
    );
  });

  it('returns 404 when the document no longer exists', async () => {
    mockUpdateDocument.mockRejectedValue(new DocumentNotFoundError());

    const res = (await baseHandler(
      makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: 'X.pdf' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(404);
  });

  it('emits DOCUMENT_RENAMED (never DOCUMENT_VIEWED) when the helper reports a real name change', async () => {
    mockUpdateDocument.mockResolvedValue({ document: makeDoc(), hasNameChanged: true });

    await baseHandler(makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: 'New Name.pdf' }));

    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DOCUMENT_RENAMED', resource: 'document', resourceId: 'doc-1' }),
    );
    expect(setAuditContext).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'DOCUMENT_VIEWED' }));
  });

  it('emits DOCUMENT_UPDATED (not DOCUMENT_RENAMED) for a non-name update', async () => {
    mockUpdateDocument.mockResolvedValue({ document: makeDoc({ indexStatus: 'ready' }), hasNameChanged: false });

    await baseHandler(makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', indexStatus: 'ready' }));

    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DOCUMENT_UPDATED' }),
    );
  });

  it('emits DOCUMENT_UPDATED (not DOCUMENT_RENAMED) for a no-op rename to the current name', async () => {
    mockUpdateDocument.mockResolvedValue({ document: makeDoc({ name: 'Same Name.pdf' }), hasNameChanged: false });

    await baseHandler(makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: 'Same Name.pdf' }));

    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'DOCUMENT_UPDATED' }),
    );
  });

  it('returns 500 for an unexpected helper failure', async () => {
    mockUpdateDocument.mockRejectedValue(new Error('dynamo down'));

    const res = (await baseHandler(
      makeEvent({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: 'X.pdf' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(500);
  });
});
