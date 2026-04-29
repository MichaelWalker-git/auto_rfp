import { Pinecone } from '@pinecone-database/pinecone';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DocumentItem } from '@auto-rfp/core';
import { getEmbedding } from './embeddings';
import { nowIso } from './date';
import { DocumentDBItem } from '@/types/document';

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
  const embedding = await getEmbedding(text);

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
 * Delete document chunks from Pinecone by documentId
 */
export async function deleteFromPinecone(orgId: string, sk: string): Promise<void> {
  const index = await getPineconeIndex();

  try {
    const results = await index.namespace(orgId).query({
      vector: new Array(1024).fill(0),
      topK: 10000,
      includeMetadata: true,
      filter: {
        [SK_NAME]: { $eq: sk },
      },
    });

    const idsToDelete = (results.matches || []).map((match) => match.id);

    if (idsToDelete.length === 0) {
      console.log(`Pinecone: no docs found for sk=${sk} (nothing to delete)`);
      return;
    }

    const batchSize = 100;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      await index.namespace(orgId).deleteMany(batch);
    }

    console.log(`Pinecone: deleted ${idsToDelete.length} docs for ${SK_NAME}=${sk}`);
  } catch (err) {
    console.error('Pinecone delete error:', err);
    throw new Error(
      `Pinecone delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}

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

/**
 * Get the Pinecone namespace for an opportunity's solicitation documents.
 * Uses a dedicated namespace per opportunity for complete isolation.
 */
export const getOpportunityNamespace = (opportunityId: string): string =>
  `opp_${opportunityId}`;

/**
 * Index a solicitation document chunk to Pinecone.
 * Called after Textract extracts text from a question file.
 */
export const indexSolicitationChunk = async (args: {
  opportunityId: string;
  questionFileId: string;
  fileName: string;
  chunkIndex: number;
  chunkKey: string;
  text: string;
}): Promise<string> => {
  const { opportunityId, questionFileId, fileName, chunkIndex, chunkKey, text } = args;

  const index = await getPineconeIndex();
  const bucket = requireEnv('DOCUMENTS_BUCKET');
  const namespace = getOpportunityNamespace(opportunityId);

  // Vector ID: unique per chunk
  const vectorId = `${questionFileId}#${chunkIndex}`;

  // Generate embedding
  const embedding = await getEmbedding(text);

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

  await index.namespace(namespace).upsert([
    {
      id: vectorId,
      values: embedding,
      metadata: metadata as Record<string, string | number | boolean>,
    },
  ]);

  console.log(`[opportunity-pinecone] Indexed chunk ${vectorId} to namespace ${namespace}`);
  return vectorId;
};

/**
 * Batch index multiple solicitation chunks (more efficient for large documents).
 */
export const indexSolicitationChunksBatch = async (
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
  const namespace = getOpportunityNamespace(opportunityId);

  // Generate embeddings in parallel (batch)
  const embeddings = await Promise.all(chunks.map(c => getEmbedding(c.text)));

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
  const BATCH_SIZE = 100;
  for (let i = 0; i < vectors.length; i += BATCH_SIZE) {
    const batch = vectors.slice(i, i + BATCH_SIZE);
    await index.namespace(namespace).upsert(batch);
  }

  console.log(`[opportunity-pinecone] Batch indexed ${vectors.length} chunks to namespace ${namespace}`);
  return vectors.map(v => v.id);
};

/**
 * Semantic search within an opportunity's solicitation documents.
 */
export const searchSolicitation = async (
  opportunityId: string,
  query: string,
  topK: number = 5,
): Promise<SolicitationSearchHit[]> => {
  const index = await getPineconeIndex();
  const namespace = getOpportunityNamespace(opportunityId);

  // Embed the query
  const embedding = await getEmbedding(query);

  const results = await index.namespace(namespace).query({
    vector: embedding,
    topK,
    includeMetadata: true,
    includeValues: false,
    filter: {
      type: { $eq: 'solicitation_chunk' },
    },
  });

  return (results.matches || []).map(match => ({
    id: match.id,
    score: match.score ?? 0,
    metadata: match.metadata as SolicitationChunkMetadata,
  }));
};

/**
 * Delete all vectors in an opportunity's namespace.
 * Called when an opportunity is deleted.
 */
export const deleteOpportunityNamespace = async (opportunityId: string): Promise<void> => {
  const index = await getPineconeIndex();
  const namespace = getOpportunityNamespace(opportunityId);

  try {
    await index.namespace(namespace).deleteAll();
    console.log(`[opportunity-pinecone] Deleted namespace ${namespace}`);
  } catch (err) {
    // Namespace might not exist if no docs were ever indexed
    console.warn(`[opportunity-pinecone] Failed to delete namespace ${namespace}:`, err);
  }
};

/**
 * Delete vectors for a specific solicitation file.
 * Called when a solicitation document is deleted.
 */
export const deleteSolicitationFile = async (
  opportunityId: string,
  questionFileId: string,
): Promise<void> => {
  const index = await getPineconeIndex();
  const namespace = getOpportunityNamespace(opportunityId);

  // Query for all chunks of this file
  const results = await index.namespace(namespace).query({
    vector: new Array(1024).fill(0), // Dummy vector for metadata-only query
    topK: 10000,
    includeMetadata: true,
    filter: {
      questionFileId: { $eq: questionFileId },
    },
  });

  const idsToDelete = (results.matches || []).map(m => m.id);

  if (idsToDelete.length === 0) {
    console.log(`[opportunity-pinecone] No chunks found for file ${questionFileId}`);
    return;
  }

  // Delete in batches
  const BATCH_SIZE = 100;
  for (let i = 0; i < idsToDelete.length; i += BATCH_SIZE) {
    const batch = idsToDelete.slice(i, i + BATCH_SIZE);
    await index.namespace(namespace).deleteMany(batch);
  }

  console.log(`[opportunity-pinecone] Deleted ${idsToDelete.length} chunks for file ${questionFileId}`);
};
