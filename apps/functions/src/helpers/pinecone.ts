import { Pinecone } from '@pinecone-database/pinecone';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DocumentItem } from '@auto-rfp/core';
import { getEmbedding } from './embeddings';
import { nowIso } from './date';
import { DocumentDBItem } from '../types/document';

const PINECONE_API_KEY = requireEnv('PINECONE_API_KEY');
const PINECONE_INDEX = requireEnv('PINECONE_INDEX');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
let pineconeClient: Pinecone | null = null;

export function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: PINECONE_API_KEY,
    });
  }
  return pineconeClient;
}

export interface PineconeHit {
  id?: string;
  score?: number;
  source?: {
    [PK_NAME]: string;
    [SK_NAME]: string;
    externalId?: string;
    documentId?: string;
    chunkKey?: string;
    chunkIndex?: number;
    [key: string]: any;
  };
}

/**
 * Semantic search using Pinecone
 */
export async function semanticSearchChunks(
  orgId: string,
  embedding: number[],
  k: number,
  type: string = 'chunk',
  kbIds?: string[],
): Promise<PineconeHit[]> {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);

  // Build filter — always filter by type, optionally by kbId
  const filter: Record<string, any> = {
    type: { $eq: type },
  };
  if (kbIds?.length) {
    filter.kbId = { $in: kbIds };
  }

  try {
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
      source: match.metadata as any, 
    }));;
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
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);
  const docDBItem = document as DocumentDBItem;
  const id = `${docDBItem[SK_NAME]}#${chunkKey}`;
  const embedding = await getEmbedding(text);

  // Extract kbId from the document's sort key (format: "KB#{kbId}#DOC#{docId}")
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
          bucket: DOCUMENTS_BUCKET,
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
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);

  try {
    // Find all vectors with matching documentId
    const results = await index.namespace(orgId).query({
      vector: new Array(1024).fill(0), // dummy vector for query structure (must match index dimension)
      topK: 10000, // get as many as possible
      includeMetadata: true,
      filter: {
        [SK_NAME]: { $eq:  sk},
      },
    });

    const idsToDelete = (results.matches || []).map((match) => match.id);

    if (idsToDelete.length === 0) {
      console.log(`Pinecone: no docs found for sk=${sk} (nothing to delete)`);
      return;
    }

    // Delete in batches to avoid hitting limits
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
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);

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