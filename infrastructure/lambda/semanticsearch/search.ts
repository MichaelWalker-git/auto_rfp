import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '../middleware/rbac-middleware';

import { getEmbedding, semanticSearchChunks, semanticSearchContentLibrary } from '../helpers/embeddings';
import { loadTextFromS3 } from '../helpers/s3';
import { PineconeHit } from '../helpers/pinecone';
import { getItem } from '../helpers/db';
import { CONTENT_LIBRARY_PK, ContentLibraryItem, } from '@auto-rfp/shared';
import { SK_NAME } from '../constants/common';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const DEFAULT_TOP_K = Number(requireEnv('TOP_CHUNKS_DEFAULT_TOP_K', '10'));
const MAX_CHUNK_TEXT_CHARS = Number(requireEnv('TOP_CHUNKS_MAX_CHUNK_TEXT_CHARS', '12000'));
const MAX_TOTAL_CHARS = Number(requireEnv('TOP_CHUNKS_MAX_TOTAL_CHARS', '60000'));

type GetTopChunksRequest = {
  question: string;
  topK?: number;
};

type SemanticResult = {
  chunkKey?: string;
  score: number;
  text: string;
};

type GetTopChunksResponse = {
  question: string;
  topK: number;
  results: SemanticResult[];
};

function truncateText(s: string, maxChars: number) {
  const t = (s ?? '').trim();
  if (!t) return '';
  return t.length <= maxChars ? t : t.slice(0, maxChars);
}

function uniqueByChunkKey(hits: PineconeHit[]): PineconeHit[] {
  const seen = new Set<string>();
  const out: PineconeHit[] = [];
  for (const h of hits) {
    const key = h.source?.chunkKey;
    const uniq = key ? !seen.has(key) : true;
    if (!uniq) continue;
    if (key) seen.add(key);
    out.push(h);
  }
  return out;
}

export const getQandA = async (
  sk?: string
) => {
  if (!sk) return '';
  const result = await getItem<ContentLibraryItem>(
    CONTENT_LIBRARY_PK,
    sk
  );
  return `
  Q: ${result?.question}
  A: ${result?.answer}
  `;
};

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'Org Id is required' });
    if (!event.body) return apiResponse(400, { message: 'Request body is required' });
    const body: GetTopChunksRequest = JSON.parse(event.body);
    const question = body.question?.trim();
    if (!question) return apiResponse(400, { message: 'question is required' });

    const topK = body.topK && body.topK > 0 ? body.topK : DEFAULT_TOP_K;

    // 1) embed question
    const embedding = await getEmbedding(question);

    const questions_hits = await semanticSearchContentLibrary(orgId, embedding, topK);

    // 2) semantic search topK hits (chunkKey + _score)
    const chunk_hits = await semanticSearchChunks(orgId, embedding, topK);

    if (!chunk_hits.length) {
      const empty: GetTopChunksResponse = { question, topK, results: [] };
      return apiResponse(200, empty);
    }

    // 3) fetch chunk texts from S3
    const uniqueHits = uniqueByChunkKey(chunk_hits);

    const results: SemanticResult[] = [];
    let totalChars = 0;

    for (const h of uniqueHits) {
      const chunkKey = h.source?.chunkKey;
      if (!chunkKey) continue;

      const rawText = await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey);
      const text = truncateText(rawText, MAX_CHUNK_TEXT_CHARS);
      if (!text) continue;

      // keep response size sane
      if (totalChars + text.length > MAX_TOTAL_CHARS) break;
      totalChars += text.length;

      results.push({
        chunkKey,
        score: h.score || 0,
        text,
      });
    }

    for (const h of questions_hits) {
      results.push({
        text: await getQandA(h?.source?.[SK_NAME]),
        score: h.score || 0,
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
