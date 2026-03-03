import { requireEnv } from './env';
import { getPineconeClient } from './pinecone';
import { nowIso } from './date';
import { ContentLibraryItem } from '@auto-rfp/core';
import { getEmbedding } from './embeddings';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DBItem } from './db';

const PINECONE_INDEX = requireEnv('PINECONE_INDEX');

/**
 * Index a content library item in Pinecone.
 * Only the question text is embedded — the answer is stored in DynamoDB
 * and retrieved at query time. This keeps the vector space focused on
 * semantic question matching rather than answer content.
 */
export const indexContentLibrary = async (
  orgId: string,
  library: ContentLibraryItem & DBItem,
): Promise<string> => {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);
  const id = library.id;

  // Embed only the question for semantic search matching
  const embedding = await getEmbedding(library.question);

  try {
    await index.namespace(orgId).upsert([
      {
        id,
        values: embedding,
        metadata: {
          type: 'content_library',
          [PK_NAME]: library[PK_NAME],
          [SK_NAME]: library[SK_NAME],
          externalId: id,
          orgId,
          category: library.category ?? '',
          approvalStatus: library.approvalStatus ?? 'DRAFT',
          createdAt: nowIso(),
        },
      },
    ]);

    console.log(`Pinecone: indexed content library item ${id} (question only)`);
    return id;
  } catch (err) {
    console.error('Pinecone index error:', err);
    throw new Error(
      `Pinecone index failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
};