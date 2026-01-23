import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { defaultProvider } from '@aws-sdk/credential-provider-node';
import { Sha256 } from '@aws-crypto/sha256-js';
import https from 'https';
import { requireEnv } from './env';
import { invokeModel } from './bedrock-http-client';

const TITAN_V2_SAFE_CHARS = 35_000;
const OPENSEARCH_ENDPOINT = requireEnv('OPENSEARCH_ENDPOINT');
const REGION = requireEnv('REGION', 'us-east-1');
const BEDROCK_EMBEDDING_MODEL_ID = requireEnv('BEDROCK_EMBEDDING_MODEL_ID');
const OPENSEARCH_INDEX = requireEnv('OPENSEARCH_INDEX');

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


export interface OpenSearchHit {
  _id?: string;
  _score?: number;
  _source?: {
    documentId?: string;
    chunkKey?: string;
    chunkIndex?: number;
    [key: string]: any;
  };

  [key: string]: any;
}

export async function semanticSearchChunks(embedding: number[], k: number): Promise<OpenSearchHit[]> {
  const endpointUrl = new URL(OPENSEARCH_ENDPOINT);

  const payload = JSON.stringify({
    size: k,
    query: {
      knn: {
        embedding: {
          vector: embedding,
          k,
        },
      },
    },
    _source: ['documentId', 'chunkKey', 'chunkIndex'],
  });

  const request = new HttpRequest({
    method: 'POST',
    protocol: endpointUrl.protocol,
    hostname: endpointUrl.hostname,
    path: `/${OPENSEARCH_INDEX}/_search`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload).toString(),
      host: endpointUrl.hostname,
    },
    body: payload,
  });

  const signer = new SignatureV4({
    service: 'aoss',
    region: REGION,
    credentials: defaultProvider(),
    sha256: Sha256,
  });

  const signed = await signer.sign(request);

  const bodyStr = await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        method: signed.method,
        hostname: signed.hostname,
        path: signed.path,
        headers: signed.headers as any,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(text);
          } else {
            reject(
              new Error(
                `OpenSearch search error: ${res.statusCode} ${res.statusMessage} - ${text}`,
              ),
            );
          }
        });
      },
    );

    req.on('error', reject);
    if (signed.body) req.write(signed.body);
    req.end();
  });

  const json = JSON.parse(bodyStr);
  return (json.hits?.hits ?? []) as OpenSearchHit[];
}


function truncateForTitan(text: string, maxChars = TITAN_V2_SAFE_CHARS): string {
  // Ensure text is a string before calling .trim() - fixes AUTO-RFP-3V
  const t = (typeof text === 'string' ? text : String(text ?? '')).trim();
  if (!t) return '';
  if (t.length <= maxChars) return t;
  return t.slice(0, maxChars);
}