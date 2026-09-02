/**
 * Tests for the solicitation RAG section of pinecone.ts.
 *
 * Key invariant: solicitation vectors live in the `{orgId}` namespace (shared with
 * document chunks, content library, etc.), and are scoped per-opportunity via metadata
 * filters — NOT per-namespace. The `opp_{oppId}` namespace is legacy and only read
 * from / deleted from during the migration window.
 *
 * Regression guard: `deleteAll()` must NEVER be called on the `{orgId}` namespace —
 * that would wipe the entire org's data. It is only safe on the legacy per-opportunity
 * namespace.
 */

process.env.PINECONE_API_KEY = 'test-key';
process.env.PINECONE_INDEX = 'test-index';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

const mockUpsert = jest.fn().mockResolvedValue({});
const mockQuery = jest.fn();
const mockDeleteMany = jest.fn().mockResolvedValue({});
const mockDeleteAll = jest.fn().mockResolvedValue({});
const mockUpdate = jest.fn().mockResolvedValue({});

// Track every namespace(...) call so we can assert which namespaces were touched
const namespaceCalls: string[] = [];
const mockNamespace = jest.fn((ns: string) => {
  namespaceCalls.push(ns);
  return {
    upsert: mockUpsert,
    query: mockQuery,
    deleteMany: mockDeleteMany,
    deleteAll: mockDeleteAll,
    update: mockUpdate,
  };
});

const mockIndex = { namespace: mockNamespace };

jest.mock('@pinecone-database/pinecone', () => ({
  Pinecone: jest.fn(() => ({
    Index: jest.fn(() => mockIndex),
  })),
}));

jest.mock('@/helpers/embeddings', () => ({
  getEmbedding: jest.fn().mockResolvedValue(new Array(1024).fill(0.1)),
}));

import {
  indexSolicitationChunksBatch,
  searchSolicitation,
  deleteOpportunitySolicitationVectors,
  deleteSolicitationFile,
  deleteFromPinecone,
  updateChunkDocumentNameInPinecone,
} from './pinecone';

describe('pinecone — solicitation RAG helpers', () => {
  beforeEach(() => {
    mockUpsert.mockClear();
    mockQuery.mockReset();
    mockDeleteMany.mockClear();
    mockDeleteAll.mockClear();
    mockUpdate.mockClear();
    mockNamespace.mockClear();
    namespaceCalls.length = 0;
  });

  describe('indexSolicitationChunksBatch', () => {
    it('upserts to the {orgId} namespace (not opp_{oppId})', async () => {
      await indexSolicitationChunksBatch('org-123', 'opp-456', [
        {
          questionFileId: 'qf-1',
          fileName: 'rfp.pdf',
          chunkIndex: 0,
          chunkKey: 'chunks/opp-456/qf-1/chunk-0.txt',
          text: 'chunk text',
        },
      ]);

      expect(namespaceCalls).toContain('org-123');
      expect(namespaceCalls).not.toContain('opp_opp-456');
      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });

    it('stores opportunityId and questionFileId in each vector metadata', async () => {
      await indexSolicitationChunksBatch('org-123', 'opp-456', [
        {
          questionFileId: 'qf-1',
          fileName: 'rfp.pdf',
          chunkIndex: 0,
          chunkKey: 'chunks/opp-456/qf-1/chunk-0.txt',
          text: 'chunk text',
        },
      ]);

      const upsertArg = mockUpsert.mock.calls[0][0];
      expect(upsertArg).toHaveLength(1);
      expect(upsertArg[0].metadata).toMatchObject({
        type: 'solicitation_chunk',
        opportunityId: 'opp-456',
        questionFileId: 'qf-1',
      });
    });

    it('returns an empty array when no chunks are provided', async () => {
      const result = await indexSolicitationChunksBatch('org-123', 'opp-456', []);
      expect(result).toEqual([]);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('searchSolicitation', () => {
    it('queries both {orgId} and legacy opp_{oppId} namespaces in parallel', async () => {
      mockQuery.mockResolvedValue({ matches: [] });

      await searchSolicitation('org-123', 'opp-456', 'what is the deadline?', 5);

      expect(namespaceCalls).toContain('org-123');
      expect(namespaceCalls).toContain('opp_opp-456');
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('scopes the org-namespace query by opportunityId metadata', async () => {
      mockQuery.mockResolvedValue({ matches: [] });

      await searchSolicitation('org-123', 'opp-456', 'q', 5);

      const orgQueryCall = mockQuery.mock.calls.find((_call, idx) => namespaceCalls[idx] === 'org-123');
      expect(orgQueryCall).toBeDefined();
      expect(orgQueryCall![0].filter).toMatchObject({
        type: { $eq: 'solicitation_chunk' },
        opportunityId: { $eq: 'opp-456' },
      });
    });

    it('swallows errors from the legacy namespace and still returns org results', async () => {
      mockQuery.mockResolvedValueOnce({
        matches: [{ id: 'v1', score: 0.9, metadata: { opportunityId: 'opp-456' } }],
      });
      mockQuery.mockRejectedValueOnce(new Error('namespace not found'));

      const hits = await searchSolicitation('org-123', 'opp-456', 'q', 5);

      expect(hits).toHaveLength(1);
      expect(hits[0].id).toBe('v1');
    });

    it('dedupes by vector ID across namespaces and keeps the higher score', async () => {
      mockQuery.mockResolvedValueOnce({
        matches: [{ id: 'v1', score: 0.5, metadata: { opportunityId: 'opp-456' } }],
      });
      mockQuery.mockResolvedValueOnce({
        matches: [{ id: 'v1', score: 0.9, metadata: { opportunityId: 'opp-456' } }],
      });

      const hits = await searchSolicitation('org-123', 'opp-456', 'q', 5);

      expect(hits).toHaveLength(1);
      expect(hits[0].score).toBe(0.9);
    });

    it('respects topK after merging', async () => {
      mockQuery.mockResolvedValueOnce({
        matches: [
          { id: 'v1', score: 0.9, metadata: {} },
          { id: 'v2', score: 0.7, metadata: {} },
        ],
      });
      mockQuery.mockResolvedValueOnce({
        matches: [{ id: 'v3', score: 0.5, metadata: {} }],
      });

      const hits = await searchSolicitation('org-123', 'opp-456', 'q', 2);

      expect(hits).toHaveLength(2);
      expect(hits.map((h) => h.id)).toEqual(['v1', 'v2']);
    });
  });

  describe('deleteOpportunitySolicitationVectors', () => {
    it('never calls deleteAll on the {orgId} namespace', async () => {
      mockQuery.mockResolvedValue({ matches: [{ id: 'v1' }, { id: 'v2' }] });

      await deleteOpportunitySolicitationVectors('org-123', 'opp-456');

      // For every deleteAll invocation, find the namespace call immediately preceding
      // it in call order and verify it wasn't the org namespace.
      for (const deleteAllOrder of mockDeleteAll.mock.invocationCallOrder) {
        const nsIdx = mockNamespace.mock.invocationCallOrder.findIndex((nsOrder, i) => {
          const nextOrder = mockNamespace.mock.invocationCallOrder[i + 1];
          return nsOrder < deleteAllOrder && (nextOrder === undefined || nextOrder > deleteAllOrder);
        });
        const nsArg = mockNamespace.mock.calls[nsIdx]?.[0];
        expect(nsArg).not.toBe('org-123');
      }
    });

    it('queries the {orgId} namespace with an opportunityId filter and deletes by ID', async () => {
      mockQuery.mockResolvedValue({ matches: [{ id: 'v1' }, { id: 'v2' }] });

      const deleted = await deleteOpportunitySolicitationVectors('org-123', 'opp-456');

      expect(namespaceCalls).toContain('org-123');
      expect(mockQuery.mock.calls[0][0].filter).toMatchObject({
        opportunityId: { $eq: 'opp-456' },
        type: { $eq: 'solicitation_chunk' },
      });
      expect(mockDeleteMany).toHaveBeenCalledWith(['v1', 'v2']);
      expect(deleted).toBe(2);
    });

    it('drains the legacy opp_{oppId} namespace via deleteAll', async () => {
      mockQuery.mockResolvedValue({ matches: [] });

      await deleteOpportunitySolicitationVectors('org-123', 'opp-456');

      expect(mockDeleteAll).toHaveBeenCalled();
      expect(namespaceCalls).toContain('opp_opp-456');
    });

    it('does not throw when the legacy namespace delete fails', async () => {
      mockQuery.mockResolvedValue({ matches: [] });
      mockDeleteAll.mockRejectedValueOnce(new Error('namespace not found'));

      await expect(deleteOpportunitySolicitationVectors('org-123', 'opp-456')).resolves.not.toThrow();
    });
  });

  describe('deleteSolicitationFile', () => {
    it('filters by opportunityId AND questionFileId in the org namespace', async () => {
      mockQuery.mockResolvedValue({ matches: [{ id: 'v1' }] });

      await deleteSolicitationFile('org-123', 'opp-456', 'qf-789');

      const orgQueryCall = mockQuery.mock.calls.find((_call, idx) => namespaceCalls[idx] === 'org-123');
      expect(orgQueryCall?.[0].filter).toMatchObject({
        type: { $eq: 'solicitation_chunk' },
        opportunityId: { $eq: 'opp-456' },
        questionFileId: { $eq: 'qf-789' },
      });
    });

    it('also deletes matching vectors from the legacy namespace', async () => {
      mockQuery.mockResolvedValue({ matches: [{ id: 'v-legacy' }] });

      await deleteSolicitationFile('org-123', 'opp-456', 'qf-789');

      expect(namespaceCalls).toContain('opp_opp-456');
    });

    it('never calls deleteAll (so it cannot wipe the org namespace)', async () => {
      mockQuery.mockResolvedValue({ matches: [] });

      await deleteSolicitationFile('org-123', 'opp-456', 'qf-789');

      expect(mockDeleteAll).not.toHaveBeenCalled();
    });

    it('does not throw when Pinecone errors on one namespace', async () => {
      mockQuery.mockRejectedValueOnce(new Error('network error'));
      mockQuery.mockResolvedValueOnce({ matches: [] });

      await expect(deleteSolicitationFile('org-123', 'opp-456', 'qf-789')).resolves.not.toThrow();
    });
  });

  describe('deleteFromPinecone', () => {
    const sk = 'KB#kb-1#DOC#doc-1';

    it('builds chunk IDs deterministically from chunkCount and never queries', async () => {
      await deleteFromPinecone('org-123', sk, {
        chunkCount: 3,
        textFileKey: 'orgs/org-123/kb-1/doc-1.txt',
      });

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockDeleteMany).toHaveBeenCalledTimes(1);
      expect(mockDeleteMany).toHaveBeenCalledWith([
        `${sk}#orgs/org-123/kb-1/chunks/1.txt`,
        `${sk}#orgs/org-123/kb-1/chunks/2.txt`,
        `${sk}#orgs/org-123/kb-1/chunks/3.txt`,
      ]);
    });

    it('skips deletion entirely when chunkCount is 0', async () => {
      await deleteFromPinecone('org-123', sk, {
        chunkCount: 0,
        textFileKey: 'orgs/org-123/kb-1/doc-1.txt',
      });

      expect(mockQuery).not.toHaveBeenCalled();
      expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    it('batches deterministic deletes in groups of 100', async () => {
      await deleteFromPinecone('org-123', sk, {
        chunkCount: 150,
        textFileKey: 'orgs/org-123/kb-1/doc-1.txt',
      });

      expect(mockDeleteMany).toHaveBeenCalledTimes(2);
      expect(mockDeleteMany.mock.calls[0][0]).toHaveLength(100);
      expect(mockDeleteMany.mock.calls[1][0]).toHaveLength(50);
    });

    it('rethrows when the deterministic delete fails', async () => {
      mockDeleteMany.mockRejectedValueOnce(new Error('pinecone down'));

      await expect(
        deleteFromPinecone('org-123', sk, { chunkCount: 1, textFileKey: 'orgs/org-123/kb-1/doc-1.txt' }),
      ).rejects.toThrow('Pinecone delete failed');
    });

    it('falls back to a paginated query-delete loop when chunkCount is missing (legacy documents)', async () => {
      mockQuery
        .mockResolvedValueOnce({ matches: [{ id: 'v1' }, { id: 'v2' }] })
        .mockResolvedValueOnce({ matches: [{ id: 'v3' }] })
        .mockResolvedValueOnce({ matches: [] });

      await deleteFromPinecone('org-123', sk);

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockDeleteMany).toHaveBeenNthCalledWith(1, ['v1', 'v2']);
      expect(mockDeleteMany).toHaveBeenNthCalledWith(2, ['v3']);
    });

    it('legacy fallback terminates as soon as a query returns no matches', async () => {
      mockQuery.mockResolvedValueOnce({ matches: [] });

      await deleteFromPinecone('org-123', sk);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockDeleteMany).not.toHaveBeenCalled();
    });

    it('legacy fallback is also used when textFileKey is missing', async () => {
      mockQuery.mockResolvedValueOnce({ matches: [] });

      await deleteFromPinecone('org-123', sk, { chunkCount: 3 });

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('rethrows when the legacy fallback query fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('network error'));

      await expect(deleteFromPinecone('org-123', sk)).rejects.toThrow('Pinecone delete failed');
    });
  });

  describe('updateChunkDocumentNameInPinecone', () => {
    const sk = 'KB#kb-1#DOC#doc-1';
    const textFileKey = 'orgs/org-123/kb-1/doc-1.txt';

    it('builds chunk IDs deterministically from chunkCount and updates each one\'s documentName metadata', async () => {
      await updateChunkDocumentNameInPinecone('org-123', sk, 3, textFileKey, 'New Name.pdf');

      expect(mockQuery).not.toHaveBeenCalled();
      expect(namespaceCalls).toContain('org-123');
      expect(mockUpdate).toHaveBeenCalledTimes(3);
      expect(mockUpdate).toHaveBeenCalledWith({
        id: `${sk}#orgs/org-123/kb-1/chunks/1.txt`,
        metadata: { documentName: 'New Name.pdf' },
      });
      expect(mockUpdate).toHaveBeenCalledWith({
        id: `${sk}#orgs/org-123/kb-1/chunks/3.txt`,
        metadata: { documentName: 'New Name.pdf' },
      });
    });

    it('does nothing when chunkCount is 0', async () => {
      await updateChunkDocumentNameInPinecone('org-123', sk, 0, textFileKey, 'New Name.pdf');

      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockNamespace).not.toHaveBeenCalled();
    });

    it('batches updates in groups of 50', async () => {
      await updateChunkDocumentNameInPinecone('org-123', sk, 120, textFileKey, 'New Name.pdf');

      expect(mockUpdate).toHaveBeenCalledTimes(120);
    });

    it('rethrows when a chunk update fails, so the caller can log and swallow it', async () => {
      mockUpdate.mockRejectedValueOnce(new Error('pinecone down'));

      await expect(
        updateChunkDocumentNameInPinecone('org-123', sk, 3, textFileKey, 'New Name.pdf'),
      ).rejects.toThrow('pinecone down');
    });
  });
});
