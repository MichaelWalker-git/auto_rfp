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
