import type { PineconeHit } from '@/types/pinecone';
import { pineconeSearch } from './pinecone';

export const semanticSearchChunks = async (
  orgId: string,
  embedding: number[],
  k: number,
  kbIds?: string[],
): Promise<PineconeHit[]> => {
  return pineconeSearch(orgId, embedding, k, 'chunk', kbIds);
};

export const semanticSearchContentLibrary = async (
  orgId: string,
  embedding: number[],
  k: number,
  kbIds?: string[],
): Promise<PineconeHit[]> => {
  return pineconeSearch(orgId, embedding, k, 'content_library', kbIds);
};

export const semanticSearchPastPerformance = async (
  orgId: string,
  embedding: number[],
  k: number,
): Promise<PineconeHit[]> => {
  return pineconeSearch(orgId, embedding, k, 'past_project');
};
