/**
 * Tests for deleteDocument: fail-fast delete ordering (Pinecone -> S3 -> DDB).
 * A failure at any step must rethrow and leave the DDB row (and any S3
 * objects not yet reached) intact so the document survives for retry.
 */

const mockGetItem = jest.fn();
const mockDeleteItem = jest.fn();
const mockS3Send = jest.fn();
const mockDeleteFromPinecone = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: (...a: unknown[]) => mockS3Send(...a) })),
  DeleteObjectCommand: jest.fn((input: unknown) => ({ input })),
}));

jest.mock('./db', () => ({
  createItem: jest.fn(),
  deleteItem: (...a: unknown[]) => mockDeleteItem(...a),
  getItem: (...a: unknown[]) => mockGetItem(...a),
  queryByPkAndSkContains: jest.fn(),
}));

jest.mock('./pinecone', () => ({
  deleteFromPinecone: (...a: unknown[]) => mockDeleteFromPinecone(...a),
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { deleteDocument } from './document';
import type { DocumentItem } from '@auto-rfp/core';

const makeItem = (overrides: Partial<DocumentItem> = {}): DocumentItem => ({
  id: 'doc-1',
  knowledgeBaseId: 'kb-1',
  name: 'Test Document',
  fileKey: 'files/doc-1.pdf',
  textFileKey: 'files/doc-1.txt',
  indexStatus: 'INDEXED',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  chunkCount: 3,
  ...overrides,
});

const dto = { id: 'doc-1', orgId: 'org-1', knowledgeBaseId: 'kb-1' };

describe('deleteDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDeleteFromPinecone.mockResolvedValue(undefined);
    mockS3Send.mockResolvedValue({});
    mockDeleteItem.mockResolvedValue(undefined);
  });

  it('happy path: runs Pinecone -> S3 -> DDB in order', async () => {
    mockGetItem.mockResolvedValue(makeItem());
    const callOrder: string[] = [];
    mockDeleteFromPinecone.mockImplementation(async () => { callOrder.push('pinecone'); });
    mockS3Send.mockImplementation(async () => { callOrder.push('s3'); return {}; });
    mockDeleteItem.mockImplementation(async () => { callOrder.push('ddb'); });

    await deleteDocument(dto);

    // Both S3 deletes (fileKey + textFileKey) run before the DDB delete.
    expect(callOrder[0]).toBe('pinecone');
    expect(callOrder.slice(1, 3).sort()).toEqual(['s3', 's3']);
    expect(callOrder[3]).toBe('ddb');
  });

  it('passes chunkCount and textFileKey through to deleteFromPinecone', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 7, textFileKey: 'files/doc-1.txt' }));

    await deleteDocument(dto);

    expect(mockDeleteFromPinecone).toHaveBeenCalledWith('org-1', 'KB#kb-1#DOC#doc-1', {
      chunkCount: 7,
      textFileKey: 'files/doc-1.txt',
    });
  });

  it('deletes both fileKey and textFileKey from S3', async () => {
    mockGetItem.mockResolvedValue(makeItem());

    await deleteDocument(dto);

    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it('Pinecone failure rethrows and preserves the DDB row and S3 objects', async () => {
    mockGetItem.mockResolvedValue(makeItem());
    mockDeleteFromPinecone.mockRejectedValue(new Error('pinecone down'));

    await expect(deleteDocument(dto)).rejects.toThrow('pinecone down');

    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('S3 failure rethrows and preserves the DDB row', async () => {
    mockGetItem.mockResolvedValue(makeItem());
    mockS3Send.mockRejectedValue(new Error('s3 down'));

    await expect(deleteDocument(dto)).rejects.toThrow('s3 down');

    expect(mockDeleteFromPinecone).toHaveBeenCalled();
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });

  it('when no DDB item exists, still attempts best-effort Pinecone cleanup, skips S3, and deletes the (already gone) row idempotently', async () => {
    mockGetItem.mockResolvedValue(null);

    await deleteDocument(dto);

    expect(mockDeleteFromPinecone).toHaveBeenCalledWith('org-1', 'KB#kb-1#DOC#doc-1', {
      chunkCount: undefined,
      textFileKey: undefined,
    });
    expect(mockS3Send).not.toHaveBeenCalled();
    expect(mockDeleteItem).toHaveBeenCalledWith('DOCUMENT', 'KB#kb-1#DOC#doc-1');
  });
});
