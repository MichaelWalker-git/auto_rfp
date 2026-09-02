import { Pinecone } from '@pinecone-database/pinecone';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DocumentItem } from '@auto-rfp/core';
import { getEmbedding } from './embeddings';
import { nowIso } from './date';
import { DocumentDBItem } from '@/types/document';
import { buildChunkKey, buildChunksPrefixFromTxtKey } from './document-keys';

import type { PineconeHit } from '@/types/pinecone';

// Lazy initialization — env vars are read on first use, not at import time.
// This prevents Lambdas that don't need Pinecone from crashing on missing env vars.
let pineconeClient: Pinecone | null = null;
let pineconeInitPromise: Promise<Pinecone> | null = null;

/**
 * Resolve an env var, handling unresolved CloudFormation secret references
 * (e.g. from hotswap deploys where {{resolve:...}} is not processed).
 */
const resolveEnv = async (name: string): Promise<string> => {
  const raw = requireEnv(name);
  if (!raw.startsWith('{{resolve:secretsmanager:')) return raw;

  // Parse secret ID from: {{resolve:secretsmanager:SECRET_ID:SecretString:::}}
  const match = raw.match(/\{\{resolve:secretsmanager:([^:}]+)/);
  if (!match) throw new Error(`Cannot parse secret reference for ${name}: ${raw}`);

  console.warn(`[pinecone] Resolving unresolved secret reference for ${name} at runtime`);
  const sm = new SecretsManagerClient({});
  const result = await sm.send(new GetSecretValueCommand({ SecretId: match[1] }));
  const value = result.SecretString;
  if (!value) throw new Error(`Secret ${match[1]} has no string value`);

  // Cache in process.env so subsequent calls don't hit Secrets Manager again
  process.env[name] = value;
  return value;
};

export const initPineconeClient = async (): Promise<Pinecone> => {
  if (pineconeClient) return pineconeClient;
  if (pineconeInitPromise) return pineconeInitPromise;

  pineconeInitPromise = (async () => {
    const apiKey = await resolveEnv('PINECONE_API_KEY');
    pineconeClient = new Pinecone({ apiKey });
    return pineconeClient;
  })();

  return pineconeInitPromise;
};

/** @deprecated Use initPineconeClient() for async initialization. Kept for sync callers. */
export const getPineconeClient = (): Pinecone => {
  if (!pineconeClient) {
    const apiKey = requireEnv('PINECONE_API_KEY');
    pineconeClient = new Pinecone({ apiKey });
  }
  return pineconeClient;
};

const getPineconeIndex = async () => {
  const client = await initPineconeClient();
  const indexName = await resolveEnv('PINECONE_INDEX');
  return client.Index(indexName);
};

/**
 * Semantic search using Pinecone
 */
export async function pineconeSearch(
  orgId: string,
  embedding: number[],
  k: number,
  type: string = 'chunk',
  kbIds?: string[],
): Promise<PineconeHit[]> {
  try {
    const index = await getPineconeIndex();

    const filter: Record<string, unknown> = {
      type: { $eq: type },
    };
    if (kbIds?.length) {
      filter.kbId = { $in: kbIds };
    }

    const results = await index.namespace(orgId).query({
      vector: embedding,
      topK: k,
      includeMetadata: true,
      includeValues: false,
      filter,
    });

    return (results.matches || []).map(match => ({
      id: match.id,
      score: match.score,
      source: match.metadata as PineconeHit['source'],
    }));
  } catch (err) {
    console.error('Pinecone search error:', err);
    throw new Error(
      `Pinecone search failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

/**
 * Index a document chunk to Pinecone
 */
export async function indexChunkToPinecone(
  orgId: string,
  document: DocumentItem,
  chunkKey: string,
  text: string
): Promise<string> {
  const index = await getPineconeIndex();
  const bucket = requireEnv('DOCUMENTS_BUCKET');
  const docDBItem = document as DocumentDBItem;
  const id = `${docDBItem[SK_NAME]}#${chunkKey}`;
  const embedding = await getEmbedding(text, orgId);

  const skParts = String(docDBItem[SK_NAME]).split('#');
  const kbId = skParts.length >= 2 ? skParts[1] : '';

  try {
    await index.namespace(orgId).upsert([
      {
        id,
        values: embedding,
        metadata: {
          id,
          type: 'chunk',
          [PK_NAME]: docDBItem[PK_NAME],
          [SK_NAME]: docDBItem[SK_NAME],
          kbId,
          documentName: docDBItem.name,
          chunkKey,
          bucket,
          createdAt: nowIso(),
        },
      },
    ]);

    console.log(`Pinecone: indexed document chunk ${id}`);
    return id;
  } catch (err) {
    console.error('Pinecone index error:', err);
    throw new Error(
      `Pinecone index failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

/**
 * Delete document chunks from Pinecone by documentId.
 *
 * When `chunkCount` (and `textFileKey`, needed to derive the chunks S3
 * prefix) is available, chunk IDs are reconstructed deterministically and
 * deleted directly — no query round-trip, no cap on chunk count.
 *
 * Legacy documents indexed before `chunkCount` was tracked fall back to a
 * paginated metadata-filtered query loop that keeps deleting until a query
 * returns no more matches.
 */
export async function deleteFromPinecone(
  orgId: string,
  sk: string,
  options?: { chunkCount?: DocumentItem['chunkCount']; textFileKey?: DocumentItem['textFileKey'] },
): Promise<void> {
  const { chunkCount, textFileKey } = options ?? {};

  if (typeof chunkCount === 'number' && textFileKey) {
    await deleteFromPineconeDeterministic(orgId, sk, chunkCount, textFileKey);
    return;
  }

  console.warn(
    `Pinecone: chunkCount unavailable for sk=${sk} (legacy document); falling back to paginated query-delete`,
  );
  await deleteFromPineconeByQuery(orgId, sk);
}

/**
 * Deterministically reconstructs a document's chunk vector IDs from its
 * persisted `chunkCount`, with no Pinecone query round-trip. Shared by the
 * delete path (`deleteFromPineconeDeterministic`) and the rename-propagation
 * path (`updateChunkDocumentNameInPinecone`) so the ID scheme only lives in
 * one place.
 */
const buildDeterministicChunkIds = (sk: string, chunkCount: number, textFileKey: string): string[] => {
  const chunksPrefix = buildChunksPrefixFromTxtKey(textFileKey);
  return Array.from({ length: chunkCount }, (_, i) => `${sk}#${buildChunkKey(chunksPrefix, i)}`);
};

async function deleteFromPineconeDeterministic(
  orgId: string,
  sk: string,
  chunkCount: number,
  textFileKey: string,
): Promise<void> {
  if (chunkCount === 0) {
    console.log(`Pinecone: chunkCount=0 for sk=${sk} (nothing to delete)`);
    return;
  }

  const idsToDelete = buildDeterministicChunkIds(sk, chunkCount, textFileKey);

  try {
    const index = await getPineconeIndex();
    const batchSize = 100;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      await index.namespace(orgId).deleteMany(batch);
    }

    console.log(`Pinecone: deleted ${idsToDelete.length} docs for ${SK_NAME}=${sk} (deterministic)`);
  } catch (err) {
    console.error('Pinecone delete error:', err);
    throw new Error(
      `Pinecone delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

async function deleteFromPineconeByQuery(orgId: string, sk: string): Promise<void> {
  const index = await getPineconeIndex();
  const PAGE_SIZE = 1000;
  const batchSize = 100;
  let totalDeleted = 0;

  try {
    for (;;) {
      const results = await index.namespace(orgId).query({
        vector: new Array(1024).fill(0),
        topK: PAGE_SIZE,
        includeMetadata: false,
        filter: {
          [SK_NAME]: { $eq: sk },
        },
      });

      const idsToDelete = (results.matches || []).map((match) => match.id);
      if (idsToDelete.length === 0) break;

      for (let i = 0; i < idsToDelete.length; i += batchSize) {
        const batch = idsToDelete.slice(i, i + batchSize);
        await index.namespace(orgId).deleteMany(batch);
      }
      totalDeleted += idsToDelete.length;
    }

    console.log(`Pinecone: deleted ${totalDeleted} docs for ${SK_NAME}=${sk} (paginated fallback)`);
  } catch (err) {
    console.error('Pinecone delete error:', err);
    throw new Error(
      `Pinecone delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

/**
 * Propagate a document rename to every chunk's `documentName` metadata, inline.
 * Chunk IDs are reconstructed deterministically (same scheme as
 * `deleteFromPineconeDeterministic`) — no query round-trip. Metadata-only
 * (`namespace.update`), so it never re-embeds.
 *
 * Batched via `Promise.all` in groups of 50 rather than the delete path's
 * sequential batches of 100 — an `update` per ID (vs. one `deleteMany` call
 * per batch) is many more round-trips, so a smaller, parallelized batch size
 * bounds in-flight requests without serializing the whole document.
 *
 * Callers gate this to bounded chunk counts (ticket: chunkCount <= 1000) and
 * must catch and swallow failures themselves — a Pinecone outage must not
 * block the rename, which has already committed to DynamoDB.
 */
export const updateChunkDocumentNameInPinecone = async (
  orgId: string,
  sk: string,
  chunkCount: number,
  textFileKey: string,
  documentName: string,
): Promise<void> => {
  if (chunkCount === 0) return;

  const ids = buildDeterministicChunkIds(sk, chunkCount, textFileKey);

  const index = await getPineconeIndex();
  const namespace = index.namespace(orgId);
  const BATCH_SIZE = 50;
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((id) => namespace.update({ id, metadata: { documentName } })));
  }

  console.log(`Pinecone: propagated documentName to ${ids.length} chunks for ${SK_NAME}=${sk}`);
};

/**
 * Delete a specific vector by ID
 */
export async function deleteVectorById(orgId: string, vectorId: string): Promise<void> {
  const index = await getPineconeIndex();

  try {
    await index.namespace(orgId).deleteOne(vectorId);
    console.log(`Pinecone: deleted vector ${vectorId}`);
  } catch (err) {
    console.error('Pinecone delete-vector error:', err);
    throw new Error(
      `Pinecone delete-vector failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

// ─── Opportunity Assistant (Solicitation RAG) ──────────────────────────────────

export interface SolicitationChunkMetadata {
  [key: string]: unknown;
  type: 'solicitation_chunk';
  opportunityId: string;
  questionFileId: string;
  fileName: string;
  chunkIndex: number;
  chunkKey: string;
  bucket: string;
  createdAt: string;
}

export interface SolicitationSearchHit {
  id: string;
  score: number;
  metadata: SolicitationChunkMetadata;
}

// Legacy per-opportunity namespace. New writes go to {orgId}; this format is only
// read/deleted for draining data created before the namespace consolidation fix.
const getLegacyOpportunityNamespace = (opportunityId: string): string =>
  `opp_${opportunityId}`;

/**
 * Index a solicitation document chunk to Pinecone under the org's namespace.
 * Called after Textract extracts text from a question file.
 */
export const indexSolicitationChunk = async (args: {
  orgId: string;
  opportunityId: string;
  questionFileId: string;
  fileName: string;
  chunkIndex: number;
  chunkKey: string;
  text: string;
}): Promise<string> => {
  const { orgId, opportunityId, questionFileId, fileName, chunkIndex, chunkKey, text } = args;

  const index = await getPineconeIndex();
  const bucket = requireEnv('DOCUMENTS_BUCKET');

  // Vector ID: unique per chunk
  const vectorId = `${questionFileId}#${chunkIndex}`;

  // Generate embedding
  const embedding = await getEmbedding(text, orgId);

  const metadata: SolicitationChunkMetadata = {
    type: 'solicitation_chunk',
    opportunityId,
    questionFileId,
    fileName,
    chunkIndex,
    chunkKey,
    bucket,
    createdAt: nowIso(),
  };

  await index.namespace(orgId).upsert([
    {
      id: vectorId,
      values: embedding,
      metadata: metadata as Record<string, string | number | boolean>,
    },
  ]);

  console.log(`[opportunity-pinecone] Indexed chunk ${vectorId} to namespace ${orgId}`);
  return vectorId;
};

// Batch size for embedding requests to avoid Bedrock throttling (matches pipeline-clustering.ts)
const EMBED_BATCH_SIZE = 10;

/**
 * Batch index multiple solicitation chunks (more efficient for large documents).
 * Processes embeddings in batches of 10 to avoid Bedrock rate limiting.
 */
export const indexSolicitationChunksBatch = async (
  orgId: string,
  opportunityId: string,
  chunks: Array<{
    questionFileId: string;
    fileName: string;
    chunkIndex: number;
    chunkKey: string;
    text: string;
  }>,
): Promise<string[]> => {
  if (chunks.length === 0) return [];

  const index = await getPineconeIndex();
  const bucket = requireEnv('DOCUMENTS_BUCKET');

  // Generate embeddings in controlled batches to avoid Bedrock throttling
  const embeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
    const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
    const batchEmbeddings = await Promise.all(batch.map(c => getEmbedding(c.text, orgId)));
    embeddings.push(...batchEmbeddings);
  }

  const vectors = chunks.map((chunk, i) => ({
    id: `${chunk.questionFileId}#${chunk.chunkIndex}`,
    values: embeddings[i],
    metadata: {
      type: 'solicitation_chunk' as const,
      opportunityId,
      questionFileId: chunk.questionFileId,
      fileName: chunk.fileName,
      chunkIndex: chunk.chunkIndex,
      chunkKey: chunk.chunkKey,
      bucket,
      createdAt: nowIso(),
    },
  }));

  // Upsert in batches of 100 (Pinecone limit)
  const UPSERT_BATCH_SIZE = 100;
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH_SIZE) {
    const batch = vectors.slice(i, i + UPSERT_BATCH_SIZE);
    await index.namespace(orgId).upsert(batch);
  }

  console.log(`[opportunity-pinecone] Batch indexed ${vectors.length} chunks to namespace ${orgId}`);
  return vectors.map(v => v.id);
};

/**
 * Semantic search within an opportunity's solicitation documents.
 * Dual-reads from the new org namespace AND the legacy opp_{id} namespace
 * during the migration window. Legacy misses are swallowed so new opportunities
 * (with no legacy namespace) still succeed.
 */
export const searchSolicitation = async (
  orgId: string,
  opportunityId: string,
  query: string,
  topK: number = 5,
): Promise<SolicitationSearchHit[]> => {
  const index = await getPineconeIndex();
  const legacyNamespace = getLegacyOpportunityNamespace(opportunityId);

  // Embed the query once, reuse for both namespace reads
  const embedding = await getEmbedding(query, orgId);

  const orgPromise = index.namespace(orgId).query({
    vector: embedding,
    topK,
    includeMetadata: true,
    includeValues: false,
    filter: {
      type: { $eq: 'solicitation_chunk' },
      opportunityId: { $eq: opportunityId },
    },
  });

  const legacyPromise = index
    .namespace(legacyNamespace)
    .query({
      vector: embedding,
      topK,
      includeMetadata: true,
      includeValues: false,
      filter: {
        type: { $eq: 'solicitation_chunk' },
      },
    })
    .catch((err) => {
      console.warn(`[opportunity-pinecone] Legacy namespace query failed (likely not-found):`, err);
      return { matches: [] as Array<{ id: string; score?: number; metadata?: unknown }> };
    });

  const [orgRes, legacyRes] = await Promise.all([orgPromise, legacyPromise]);

  // Dedupe by vector ID; prefer the higher score when both namespaces return the same ID
  const byId = new Map<string, SolicitationSearchHit>();
  const ingest = (matches: Array<{ id: string; score?: number; metadata?: unknown }>) => {
    for (const m of matches) {
      const hit: SolicitationSearchHit = {
        id: m.id,
        score: m.score ?? 0,
        metadata: m.metadata as SolicitationChunkMetadata,
      };
      const existing = byId.get(m.id);
      if (!existing || hit.score > existing.score) byId.set(m.id, hit);
    }
  };
  ingest(orgRes.matches ?? []);
  ingest(legacyRes.matches ?? []);

  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
};

/**
 * Delete all solicitation vectors for an opportunity.
 * Called when an opportunity is deleted.
 *
 * CRITICAL: must never `deleteAll()` on the {orgId} namespace — that would wipe
 * document chunks, content library, past performance, and clustering data for
 * the whole org. Uses a metadata filter to scope deletes to one opportunity.
 *
 * The legacy `opp_{opportunityId}` namespace (if it still holds data from
 * before the namespace consolidation fix) IS safe to `deleteAll` because it
 * only ever held one opportunity's vectors.
 */
export const deleteOpportunitySolicitationVectors = async (
  orgId: string,
  opportunityId: string,
): Promise<number> => {
  const index = await getPineconeIndex();
  const legacyNamespace = getLegacyOpportunityNamespace(opportunityId);

  // Clean up the shared org namespace by metadata filter
  let deleted = 0;
  try {
    const results = await index.namespace(orgId).query({
      vector: new Array(1024).fill(0),
      topK: 10000,
      includeMetadata: true,
      filter: {
        opportunityId: { $eq: opportunityId },
        type: { $eq: 'solicitation_chunk' },
      },
    });
    const idsToDelete = (results.matches ?? []).map((m) => m.id);
    if (idsToDelete.length > 0) {
      const BATCH_SIZE = 100;
      for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
        const batch = idsToDelete.slice(i, i + BATCH_SIZE);
        await index.namespace(orgId).deleteMany(batch);
      }
      deleted = idsToDelete.length;
    }
    console.log(`[opportunity-pinecone] Deleted ${deleted} solicitation vectors for opp ${opportunityId} from namespace ${orgId}`);
  } catch (err) {
    console.warn(`[opportunity-pinecone] Org-namespace delete failed for opp ${opportunityId}:`, err);
  }

  // Best-effort legacy namespace drain (safe here — legacy namespace is per-opportunity only)
  try {
    await index.namespace(legacyNamespace).deleteAll();
    console.log(`[opportunity-pinecone] Drained legacy namespace ${legacyNamespace}`);
  } catch (err) {
    // Namespace might not exist if no docs were ever indexed there — not an error
    console.warn(`[opportunity-pinecone] Legacy namespace drain skipped for ${legacyNamespace}:`, err);
  }

  return deleted;
};

/**
 * Delete vectors for a specific solicitation file, scoped by opportunity.
 * Called when a single solicitation document is deleted.
 */
export const deleteSolicitationFile = async (
  orgId: string,
  opportunityId: string,
  questionFileId: string,
): Promise<number> => {
  const index = await getPineconeIndex();
  const legacyNamespace = getLegacyOpportunityNamespace(opportunityId);

  const deleteFromNamespace = async (
    namespace: string,
    filter: Record<string, unknown>,
    label: string,
  ): Promise<number> => {
    try {
      const results = await index.namespace(namespace).query({
        vector: new Array(1024).fill(0),
        topK: 10000,
        includeMetadata: true,
        filter,
      });
      const idsToDelete = (results.matches ?? []).map((m) => m.id);
      if (idsToDelete.length === 0) return 0;
      const BATCH_SIZE = 100;
      for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
        const batch = idsToDelete.slice(i, i + BATCH_SIZE);
        await index.namespace(namespace).deleteMany(batch);
      }
      console.log(`[opportunity-pinecone] Deleted ${idsToDelete.length} chunks for file ${questionFileId} from ${label}`);
      return idsToDelete.length;
    } catch (err) {
      console.warn(`[opportunity-pinecone] Delete from ${label} failed for file ${questionFileId}:`, err);
      return 0;
    }
  };

  const [fromOrg, fromLegacy] = await Promise.all([
    deleteFromNamespace(
      orgId,
      {
        type: { $eq: 'solicitation_chunk' },
        opportunityId: { $eq: opportunityId },
        questionFileId: { $eq: questionFileId },
      },
      `namespace ${orgId}`,
    ),
    deleteFromNamespace(
      legacyNamespace,
      { questionFileId: { $eq: questionFileId } },
      `legacy namespace ${legacyNamespace}`,
    ),
  ]);

  return fromOrg + fromLegacy;
};
