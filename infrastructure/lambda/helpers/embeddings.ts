import { requireEnv } from './env';
import { invokeModel } from './bedrock-http-client';
import { PineconeHit, semanticSearchChunks as pineconeSearch } from './pinecone';

const TITAN_V2_SAFE_CHARS = 35_000;
const BEDROCK_EMBEDDING_MODEL_ID = requireEnv('BEDROCK_EMBEDDING_MODEL_ID');

export async function getEmbedding(text: string): Promise<number[]> {
  const body = {
    inputText: truncateForTitan(text),
  };

  const responseBody = await invokeModel(
    BEDROCK_EMBEDDING_MODEL_ID,
    JSON.stringify(body),
    'application/json',
    'application/json'
  );

  const responseString = new TextDecoder('utf-8').decode(responseBody);

  let json: any;
  try {
    json = JSON.parse(responseString);
  } catch (err) {
    console.error('Embedding model raw response:', responseString);
    throw new Error('Invalid JSON from embedding model');
  }

  // Titan embedding structure: { embedding: number[] } or similar
  const vector: number[] =
    json.embedding ||
    json.vector ||
    json.embeddings?.[0]?.embedding ||
    null;

  if (!vector || !Array.isArray(vector)) {
    console.error('Unexpected embedding payload:', json);
    throw new Error('Embedding not found in model response');
  }

  return vector;
}

export async function semanticSearchChunks(orgId: string, embedding: number[], k: number): Promise<PineconeHit[]> {
  return pineconeSearch(orgId, embedding, k);
}


function truncateForTitan(text: string, maxChars = TITAN_V2_SAFE_CHARS): string {
  // Ensure text is a string before calling .trim() - fixes AUTO-RFP-3V
  const t = (typeof text === 'string' ? text : String(text ?? '')).trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars);
}