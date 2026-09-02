/**
 * Tests for deleteDocument: fail-fast delete ordering (Pinecone -> S3 -> DDB).
 * A failure at any step must rethrow and leave the DDB row (and any S3
 * objects not yet reached) intact so the document survives for retry.
 */

const mockGetItem = jest.fn();
const mockDeleteItem = jest.fn();
const mockS3Send = jest.fn();
const mockDeleteFromPinecone = jest.fn();
const mockQueryAllBySkPrefix = jest.fn();
const mockUpdateItem = jest.fn();
const mockUpdateChunkDocumentNameInPinecone = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: (...a: unknown[]) => mockS3Send(...a) })),
  DeleteObjectCommand: jest.fn((input: unknown) => ({ input })),
}));

jest.mock('./db', () => ({
  createItem: jest.fn(),
  deleteItem: (...a: unknown[]) => mockDeleteItem(...a),
  getItem: (...a: unknown[]) => mockGetItem(...a),
  queryByPkAndSkContains: jest.fn(),
  queryAllBySkPrefix: (...a: unknown[]) => mockQueryAllBySkPrefix(...a),
  updateItem: (...a: unknown[]) => mockUpdateItem(...a),
}));

jest.mock('./pinecone', () => ({
  deleteFromPinecone: (...a: unknown[]) => mockDeleteFromPinecone(...a),
  updateChunkDocumentNameInPinecone: (...a: unknown[]) => mockUpdateChunkDocumentNameInPinecone(...a),
}));

process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { deleteDocument, updateDocument, DuplicateDocumentNameError, DocumentNotFoundError } from './document';
import type { DocumentItem, UpdateDocumentDTO } from '@auto-rfp/core';

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

describe('updateDocument', () => {
  const sk = 'KB#kb-1#DOC#doc-1';
  const renameDto: UpdateDocumentDTO = { id: 'doc-1', knowledgeBaseId: 'kb-1', orgId: 'org-1', name: 'New Name.pdf' };

  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryAllBySkPrefix.mockResolvedValue([]);
    mockUpdateItem.mockImplementation(async (_pk: string, _sk: string, updates: Partial<DocumentItem>) => makeItem(updates));
    mockUpdateChunkDocumentNameInPinecone.mockResolvedValue(undefined);
  });

  it('throws DocumentNotFoundError when the document no longer exists', async () => {
    mockGetItem.mockResolvedValue(null);

    await expect(updateDocument(renameDto)).rejects.toThrow(DocumentNotFoundError);
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('happy path: renames the document, persists the new name, and reports hasNameChanged', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 3, name: 'Old Name.pdf' }));

    const result = await updateDocument(renameDto);

    expect(mockUpdateItem).toHaveBeenCalledWith('DOCUMENT', sk, { name: 'New Name.pdf' });
    expect(result.document.name).toBe('New Name.pdf');
    expect(result.hasNameChanged).toBe(true);
  });

  it('rejects a case-insensitive duplicate name within the same KB, skipping the target\'s own SK', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 3, name: 'Old Name.pdf' }));
    mockQueryAllBySkPrefix.mockResolvedValue([
      { ...makeItem({ id: 'doc-1', name: 'Old Name.pdf' }), sort_key: sk },
      { ...makeItem({ id: 'doc-2', name: 'new name.pdf' }), sort_key: 'KB#kb-1#DOC#doc-2' },
    ]);

    await expect(updateDocument(renameDto)).rejects.toThrow(DuplicateDocumentNameError);
    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(mockQueryAllBySkPrefix).toHaveBeenCalledWith('DOCUMENT', 'KB#kb-1#DOC#');
  });

  it('does not treat renaming to its own current name as a conflict or a name change', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 3, name: 'Same Name.pdf' }));
    mockQueryAllBySkPrefix.mockResolvedValue([
      { ...makeItem({ id: 'doc-1', name: 'Same Name.pdf' }), sort_key: sk },
    ]);

    const result = await updateDocument({ ...renameDto, name: 'Same Name.pdf' });

    // No name change occurred, so the uniqueness scan and Pinecone propagation are both skipped,
    // and the caller (the handler) can tell this wasn't really a rename.
    expect(mockQueryAllBySkPrefix).not.toHaveBeenCalled();
    expect(mockUpdateChunkDocumentNameInPinecone).not.toHaveBeenCalled();
    expect(result.hasNameChanged).toBe(false);
  });

  it('propagates the renamed documentName to Pinecone chunk metadata inline when chunkCount <= 1000', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 1000, name: 'Old Name.pdf', textFileKey: 'files/doc-1.txt' }));

    await updateDocument(renameDto);

    expect(mockUpdateChunkDocumentNameInPinecone).toHaveBeenCalledWith(
      'org-1',
      sk,
      1000,
      'files/doc-1.txt',
      'New Name.pdf',
    );
  });

  it('skips inline Pinecone propagation when chunkCount exceeds 1000 (async worker handles it)', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 1001, name: 'Old Name.pdf' }));

    const result = await updateDocument(renameDto);

    expect(mockUpdateChunkDocumentNameInPinecone).not.toHaveBeenCalled();
    expect(mockUpdateItem).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('skips inline Pinecone propagation for legacy documents with no chunkCount', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: undefined, name: 'Old Name.pdf' }));

    await updateDocument(renameDto);

    expect(mockUpdateChunkDocumentNameInPinecone).not.toHaveBeenCalled();
  });

  it('skips inline Pinecone propagation when orgId is not provided', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 3, name: 'Old Name.pdf' }));

    await updateDocument({ id: 'doc-1', knowledgeBaseId: 'kb-1', name: 'New Name.pdf' });

    expect(mockUpdateChunkDocumentNameInPinecone).not.toHaveBeenCalled();
  });

  it('logs and swallows a Pinecone chunk-metadata propagation failure — the rename already committed', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 3, name: 'Old Name.pdf', textFileKey: 'files/doc-1.txt' }));
    mockUpdateChunkDocumentNameInPinecone.mockRejectedValue(new Error('pinecone down'));

    const result = await updateDocument(renameDto);

    expect(result).toBeDefined();
    expect(mockUpdateItem).toHaveBeenCalled();
  });

  it('does not run the uniqueness check or Pinecone propagation for a non-name update, and reports hasNameChanged: false', async () => {
    mockGetItem.mockResolvedValue(makeItem({ chunkCount: 3, name: 'Old Name.pdf' }));

    const result = await updateDocument({ id: 'doc-1', knowledgeBaseId: 'kb-1', indexStatus: 'ready' });

    expect(mockQueryAllBySkPrefix).not.toHaveBeenCalled();
    expect(mockUpdateChunkDocumentNameInPinecone).not.toHaveBeenCalled();
    expect(mockUpdateItem).toHaveBeenCalledWith('DOCUMENT', sk, { indexStatus: 'ready' });
    expect(result.hasNameChanged).toBe(false);
  });
});
