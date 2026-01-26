import { Pinecone } from '@pinecone-database/pinecone';
import { requireEnv } from './env';

const PINECONE_API_KEY = requireEnv('PINECONE_API_KEY');
const PINECONE_INDEX = requireEnv('PINECONE_INDEX');
const PINECONE_NAMESPACE = requireEnv('PINECONE_NAMESPACE', 'documents');

let pineconeClient: Pinecone | null = null;

function getPineconeClient(): Pinecone {
  if (!pineconeClient) {
    pineconeClient = new Pinecone({
      apiKey: PINECONE_API_KEY,
    });
  }
  return pineconeClient;
}

export interface PineconeMatch {
  id: string;
  score: number;
  values: number[];
  metadata?: {
    documentId?: string;
    chunkKey?: string;
    chunkIndex?: number;
    bucket?: string;
    externalId?: string;
    createdAt?: string;
    [key: string]: any;
  };
}

export interface PineconeHit {
  _id?: string;
  _score?: number;
  _source?: {
    documentId?: string;
    chunkKey?: string;
    chunkIndex?: number;
    [key: string]: any;
  };
}

/**
 * Convert Pinecone match to OpenSearch-like hit format for compatibility
 */
function matchToHit(match: any): PineconeHit {
  return {
    _id: match.id,
    _score: match.score ?? 0,
    _source: {
      documentId: match.metadata?.documentId,
      chunkKey: match.metadata?.chunkKey,
      chunkIndex: match.metadata?.chunkIndex,
      ...match.metadata,
    },
  };
}

/**
 * Semantic search using Pinecone
 */
export async function semanticSearchChunks(
  embedding: number[],
  k: number,
): Promise<PineconeHit[]> {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);

  try {
    const results = await index.namespace(PINECONE_NAMESPACE).query({
      vector: embedding,
      topK: k,
      includeMetadata: true,
      includeValues: false,
    });

    return (results.matches || []).map(matchToHit);
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
export async function indexDocToPinecone(
  documentId: string,
  chunkKey: string,
  bucket: string,
  embedding: number[],
  externalId: string,
): Promise<string> {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);

  const id = externalId || chunkKey;

  try {
    await index.namespace(PINECONE_NAMESPACE).upsert([
      {
        id,
        values: embedding,
        metadata: {
          type: 'chunk',
          documentId,
          chunkKey,
          bucket,
          externalId,
          createdAt: new Date().toISOString(),
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
export async function deleteFromPinecone(documentId: string): Promise<void> {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);

  try {
    // Find all vectors with matching documentId
    const results = await index.namespace(PINECONE_NAMESPACE).query({
      vector: new Array(1024).fill(0), // dummy vector for query structure (must match index dimension)
      topK: 10000, // get as many as possible
      includeMetadata: true,
      filter: {
        documentId: { $eq: documentId },
      },
    });

    const idsToDelete = (results.matches || []).map((match) => match.id);

    if (idsToDelete.length === 0) {
      console.log(`Pinecone: no docs found for documentId=${documentId} (nothing to delete)`);
      return;
    }

    // Delete in batches to avoid hitting limits
    const batchSize = 100;
    for (let i = 0; i < idsToDelete.length; i += batchSize) {
      const batch = idsToDelete.slice(i, i + batchSize);
      await index.namespace(PINECONE_NAMESPACE).deleteMany(batch);
    }

    console.log(`Pinecone: deleted ${idsToDelete.length} docs for documentId=${documentId}`);
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
export async function deleteVectorById(vectorId: string): Promise<void> {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);

  try {
    await index.namespace(PINECONE_NAMESPACE).deleteOne(vectorId);
    console.log(`Pinecone: deleted vector ${vectorId}`);
  } catch (err) {
    console.error('Pinecone delete-vector error:', err);
    throw new Error(
      `Pinecone delete-vector failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
}