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
