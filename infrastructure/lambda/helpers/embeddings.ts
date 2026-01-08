import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { invokeModel } from './bedrock-http-client';

export async function getEmbedding(
  bedrockClient: BedrockRuntimeClient,
  modelId: string,
  text: string
): Promise<number[]> {
  const body = {
    inputText: text,
  };

  const responseBody = await invokeModel(
    modelId,
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
