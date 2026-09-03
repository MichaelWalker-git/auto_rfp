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
 * The S3 key the pipeline stores extracted text under: the original key with
 * its extension swapped for `.txt`, so the text sits next to the original
 * (`…/CV.docx` → `…/CV.txt`). Any query string is dropped first.
 */
export const buildTxtKeyNextToOriginal = (originalKey: string): string => {
  const clean = originalKey.split('?')[0] ?? originalKey;
  const idx = clean.lastIndexOf('.');
  return idx === -1 ? `${clean}.txt` : `${clean.slice(0, idx)}.txt`;
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
