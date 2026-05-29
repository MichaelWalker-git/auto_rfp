import { requireEnv } from './env';
import { getPineconeClient } from './pinecone';
import { nowIso } from './date';
import { ContentLibraryItem } from '@auto-rfp/core';
import { getEmbedding } from './embeddings';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DBItem } from './db';

const PINECONE_INDEX = requireEnv('PINECONE_INDEX');

export const indexContentLibrary = async (
  orgId: string,
  library: ContentLibraryItem & DBItem,
) => {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);
  const id = library.id;
  const embedding = await getEmbedding(library.question);

  // Extract kbId from the content library's sort key (format: "{orgId}#{kbId}#{itemId}")
  const skParts = String(library[SK_NAME]).split('#');
  const kbId = skParts.length >= 2 ? skParts[1] : '';

  try {
    await index.namespace(orgId).upsert([
      {
        id,
        values: embedding,
        metadata: {
          type: 'content_library',
          [PK_NAME]: library[PK_NAME],
          [SK_NAME]: library[SK_NAME],
          kbId,
          externalId: id,
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
};