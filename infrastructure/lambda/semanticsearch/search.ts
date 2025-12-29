import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '../middleware/rbac-middleware';

import { getEmbedding, type OpenSearchHit, semanticSearchChunks } from '../helpers/embeddings';
import { loadTextFromS3 } from '../helpers/executive-opportunity-frief';

const REGION = requireEnv('REGION');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const OPENSEARCH_ENDPOINT = requireEnv('OPENSEARCH_ENDPOINT');
const OPENSEARCH_INDEX = requireEnv('OPENSEARCH_INDEX');
const BEDROCK_EMBEDDING_MODEL_ID = requireEnv('BEDROCK_EMBEDDING_MODEL_ID');

const DEFAULT_TOP_K = Number(requireEnv('TOP_CHUNKS_DEFAULT_TOP_K', '10'));
const MAX_CHUNK_TEXT_CHARS = Number(requireEnv('TOP_CHUNKS_MAX_CHUNK_TEXT_CHARS', '12000'));
const MAX_TOTAL_CHARS = Number(requireEnv('TOP_CHUNKS_MAX_TOTAL_CHARS', '60000'));

const bedrockClient = new BedrockRuntimeClient({ region: REGION });

type GetTopChunksRequest = {
  question: string;
  topK?: number;
};

type ChunkResult = {
  chunkKey: string;
  score: number;
  text: string;
};

type GetTopChunksResponse = {
  question: string;
  topK: number;
  results: ChunkResult[];
};

function truncateText(s: string, maxChars: number) {
  const t = (s ?? '').trim();
  if (!t) return '';
  return t.length <= maxChars ? t : t.slice(0, maxChars);
}

function normalizeScore(osScore: any): number {
  const s = Number(osScore ?? 0);
  if (!Number.isFinite(s) || s <= 0) return 0;
  // squash to 0..1; stable even if _score magnitude varies
  return Math.min(1, Math.max(0, 1 - Math.exp(-s)));
}

function uniqueByChunkKey(hits: OpenSearchHit[]): OpenSearchHit[] {
  const seen = new Set<string>();
  const out: OpenSearchHit[] = [];
  for (const h of hits) {
    const key = h._source?.chunkKey;
    const uniq = key ? !seen.has(key) : true;
    if (!uniq) continue;
    if (key) seen.add(key);
    out.push(h);
  }
  return out;
}

// ---------------- handler ----------------
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) return apiResponse(400, { message: 'Request body is required' });

    let body: GetTopChunksRequest;
    try {
      body = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON body' });
    }

    const question = body.question?.trim();
    if (!question) return apiResponse(400, { message: 'question is required' });

    const topK = body.topK && body.topK > 0 ? body.topK : DEFAULT_TOP_K;

    // 1) embed question
    const embedding = await getEmbedding(bedrockClient, BEDROCK_EMBEDDING_MODEL_ID, question);

    // 2) semantic search topK hits (chunkKey + _score)
    const hits = await semanticSearchChunks(
      OPENSEARCH_ENDPOINT,
      embedding,
      OPENSEARCH_INDEX,
      topK,
      REGION,
    );

    if (!hits.length) {
      const empty: GetTopChunksResponse = { question, topK, results: [] };
      return apiResponse(200, empty);
    }

    // 3) fetch chunk texts from S3
    const uniqueHits = uniqueByChunkKey(hits);

    const results: ChunkResult[] = [];
    let totalChars = 0;

    for (const h of uniqueHits) {
      const chunkKey = h._source?.chunkKey;
      if (!chunkKey) continue;

      const rawText = await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey);
      const text = truncateText(rawText, MAX_CHUNK_TEXT_CHARS);
      if (!text) continue;

      // keep response size sane
      if (totalChars + text.length > MAX_TOTAL_CHARS) break;
      totalChars += text.length;

      results.push({
        chunkKey,
        score: normalizeScore(h._score),
        text,
      });
    }

    const resp: GetTopChunksResponse = { question, topK, results };
    return apiResponse(200, resp);
  } catch (err) {
    console.error('Error in get-top-chunks:', err);
    return apiResponse(500, {
      message: 'Failed to retrieve top chunks',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);
