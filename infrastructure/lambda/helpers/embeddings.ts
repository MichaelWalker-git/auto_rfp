import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';

export async function getEmbedding(
  bedrockClient: BedrockRuntimeClient,
  modelId: string,
  text: string
): Promise<number[]> {
  const body = {
    inputText: text,
  };

  const command = new InvokeModelCommand({
    modelId: modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const response = await bedrockClient.send(command);

  if (!response.body) {
    throw new Error('Empty response body from Bedrock embeddings model');
  }

  const responseString = new TextDecoder('utf-8').decode(
    response.body as Uint8Array,
  );

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
