import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { GetObjectCommand, S3Client, } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { apiResponse } from '../helpers/api';
import { getEmbedding } from '../helpers/embeddings';

const REGION = process.env.AWS_REGION || 'us-east-1';
const DEFAULT_BUCKET = process.env.DOCUMENTS_BUCKET;

const OPENSEARCH_ENDPOINT = process.env.OPENSEARCH_ENDPOINT;
const OPENSEARCH_INDEX = process.env.OPENSEARCH_INDEX || 'rfp-rag-index';

const EMBEDDING_MODEL_ID =
  process.env.BEDROCK_EMBEDDING_MODEL_ID ||
  'amazon.titan-embed-text-v2:0';

if (!DEFAULT_BUCKET) {
  throw new Error('DOCUMENTS_BUCKET environment variable is not set');
}
if (!OPENSEARCH_ENDPOINT) {
  throw new Error('OPENSEARCH_ENDPOINT environment variable is not set');
}

const s3Client = new S3Client({ region: REGION });
const bedrockClient = new BedrockRuntimeClient({ region: REGION });

// Simple basic-auth client for OpenSearch (dev-friendly);
// switch to SigV4 if you use IAM-auth.
const opensearchClient = new OpenSearchClient({
  node: OPENSEARCH_ENDPOINT,
  auth: process.env.OPENSEARCH_USERNAME
    ? {
      username: process.env.OPENSEARCH_USERNAME,
      password: process.env.OPENSEARCH_PASSWORD || '',
    }
    : undefined,
});

interface CreateIndexRequestBody {
  s3Key?: string;     // key of original or txt file
  s3Bucket?: string;  // optional, defaults to DOCUMENTS_BUCKET
  docId?: string;     // optional higher-level id (e.g. projectId-documentId)
}

/**
 * Main handler: given s3Key => read text => chunk => embed => index into OpenSearch.
 */
export const handler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const method =
      event.requestContext.http?.method ??
      (event as any).httpMethod;

    if (method !== 'POST') {
      return apiResponse(405, { message: 'Method Not Allowed. Use POST.' });
    }

    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;

    let body: CreateIndexRequestBody;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const { s3Key, s3Bucket, docId } = body;

    if (!s3Key) {
      return apiResponse(400, {
        message: "'s3Key' is required in the request body",
      });
    }

    const bucketToUse = s3Bucket || DEFAULT_BUCKET;

    // 1) Resolve txt key: if not .txt, assume normalized key is same path with .txt
    const txtKey = ensureTxtKey(s3Key);

    // 2) Read text from S3
    const text = await getObjectAsString(bucketToUse, txtKey);

    if (!text || !text.trim()) {
      return apiResponse(400, {
        message: `Text content is empty for key ${txtKey}`,
      });
    }

    // 3) Chunk the text for RAG
    const chunks = chunkText(text, {
      maxChars: 2000,
      overlap: 200,
    });

    // 4) Generate embeddings for each chunk via Bedrock
    const embeddedChunks = await embedChunks(chunks, {
      fileKey: s3Key,
      txtKey,
      docId,
    });

    // 5) Index into OpenSearch
    await indexChunksToOpenSearch(embeddedChunks);

    return apiResponse(200, {
      message: 'Indexed chunks successfully',
      bucket: bucketToUse,
      inputKey: s3Key,
      txtKey,
      index: OPENSEARCH_INDEX,
      indexedChunks: embeddedChunks.length,
    });
  } catch (error) {
    console.error('Error in create-index-from-file handler:', error);
    return apiResponse(500, {
      message: 'Failed to create index from file',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};

// -------- S3 helpers --------

async function getObjectAsString(bucket: string, key: string): Promise<string> {
  const res = await s3Client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  if (!res.Body) {
    throw new Error('Empty S3 object body');
  }

  const body: any = res.Body;

  if (typeof body.transformToString === 'function') {
    return await body.transformToString();
  }

  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    body.on('data', (chunk: Buffer) => chunks.push(chunk));
    body.on('error', reject);
    body.on('end', () =>
      resolve(Buffer.concat(chunks).toString('utf-8')),
    );
  });
}

function ensureTxtKey(key: string): string {
  const lastDot = key.lastIndexOf('.');
  if (lastDot === -1) {
    return `${key}.txt`;
  }
  const ext = key.slice(lastDot + 1).toLowerCase();
  if (ext === 'txt') return key;
  return `${key.slice(0, lastDot)}.txt`;
}

// -------- Chunking helpers --------

interface ChunkOptions {
  maxChars: number;
  overlap: number;
}

interface TextChunk {
  id: string;
  index: number;
  content: string;
}

function chunkText(text: string, options: ChunkOptions): TextChunk[] {
  const { maxChars, overlap } = options;
  const chunks: TextChunk[] = [];

  const normalized = text.replace(/\r\n/g, '\n').trim();
  let start = 0;
  let idx = 0;

  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    const slice = normalized.slice(start, end);

    chunks.push({
      id: `chunk_${idx}`,
      index: idx,
      content: slice,
    });

    if (end === normalized.length) break;

    start = end - overlap;
    if (start < 0) start = 0;
    idx += 1;
  }

  return chunks;
}

// -------- Embedding helpers --------

interface EmbeddedChunk extends TextChunk {
  embedding: number[];
  fileKey: string;
  txtKey: string;
  docId?: string;
}

interface EmbedContext {
  fileKey: string;
  txtKey: string;
  docId?: string;
}

async function embedChunks(
  chunks: TextChunk[],
  ctx: EmbedContext,
): Promise<EmbeddedChunk[]> {
  const result: EmbeddedChunk[] = [];

  for (const chunk of chunks) {
    const embedding = await getEmbedding(bedrockClient, EMBEDDING_MODEL_ID, chunk.content);
    result.push({
      ...chunk,
      embedding,
      fileKey: ctx.fileKey,
      txtKey: ctx.txtKey,
      docId: ctx.docId,
    });
  }

  return result;
}


// -------- OpenSearch helpers --------

async function indexChunksToOpenSearch(
  chunks: EmbeddedChunk[],
): Promise<void> {
  if (!chunks.length) return;

  const body: any[] = [];

  for (const chunk of chunks) {
    const docId = `${chunk.fileKey}::${chunk.id}`;
    body.push({
      index: { _index: OPENSEARCH_INDEX, _id: docId },
    });
    body.push({
      fileKey: chunk.fileKey,
      txtKey: chunk.txtKey,
      docId: chunk.docId,
      chunkId: chunk.id,
      chunkIndex: chunk.index,
      content: chunk.content,
      embedding: chunk.embedding,
      createdAt: new Date().toISOString(),
    });
  }

  const resp = await opensearchClient.bulk({
    index: OPENSEARCH_INDEX,
    body,
    refresh: 'true',
  });

  if ((resp.body as any).errors) {
    console.error('Bulk indexing errors:', JSON.stringify(resp.body, null, 2));
    throw new Error('Failed to index some chunks into OpenSearch');
  }
}
