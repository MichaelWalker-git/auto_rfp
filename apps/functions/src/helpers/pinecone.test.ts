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

// Track every namespace(...) call so we can assert which namespaces were touched
const namespaceCalls: string[] = [];
const mockNamespace = jest.fn((ns: string) => {
  namespaceCalls.push(ns);
  return {
    upsert: mockUpsert,
    query: mockQuery,
    deleteMany: mockDeleteMany,
    deleteAll: mockDeleteAll,
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
} from './pinecone';

describe('pinecone — solicitation RAG helpers', () => {
  beforeEach(() => {
    mockUpsert.mockClear();
    mockQuery.mockReset();
    mockDeleteMany.mockClear();
    mockDeleteAll.mockClear();
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
});
