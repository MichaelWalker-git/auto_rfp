/**
 * Lightweight document key helpers.
 *
 * This module intentionally avoids importing heavy dependencies (Pinecone,
 * Bedrock, S3, etc.) so that handlers which only need to build DynamoDB
 * keys can import from here without pulling in the entire document helper
 * graph — which would otherwise trigger module-level `requireEnv` calls
 * for Pinecone / Bedrock env vars and crash Lambdas that don't need them.
 */

export const buildDocumentSK = (kbId: string, docId: string): string => {
  return `KB#${kbId}#DOC#${docId}`;
};

/**
 * Derives the S3 "chunks/" prefix from a document's extracted-text key.
 * Chunks for `some/dir/doc.txt` live at `some/dir/chunks/`.
 */
export const buildChunksPrefixFromTxtKey = (txtKey: string): string => {
  const lastSlash = txtKey.lastIndexOf('/');
  const dir = lastSlash >= 0 ? txtKey.slice(0, lastSlash) : '';
  return (dir ? `${dir}/` : '') + 'chunks/';
};

/**
 * Builds the S3 key for the chunk at `index` (0-based) under `chunksPrefix`.
 * Matches the 1-based file naming produced by the chunking pipeline
 * (`${chunksPrefix}${i + 1}.txt`).
 */
export const buildChunkKey = (chunksPrefix: string, index: number): string => {
  return `${chunksPrefix}${index + 1}.txt`;
};
