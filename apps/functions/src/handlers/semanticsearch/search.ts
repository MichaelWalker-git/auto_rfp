import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware } from '@/middleware/rbac-middleware';

import { getEmbedding, semanticSearchChunks, semanticSearchContentLibrary, semanticSearchPastPerformance } from '@/helpers/embeddings';
import { loadTextFromS3 } from '@/helpers/s3';
import { PineconeHit } from '@/helpers/pinecone';
import { getItem } from '@/helpers/db';
import { CONTENT_LIBRARY_PK, ContentLibraryItem } from '@auto-rfp/core';
import { SK_NAME } from '@/constants/common';
import { getLinkedKBIds } from '@/helpers/project-kb';
import { getPastProject } from '@/helpers/past-performance';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const DEFAULT_TOP_K = Number(requireEnv('TOP_CHUNKS_DEFAULT_TOP_K', '10'));
const MAX_CHUNK_TEXT_CHARS = Number(requireEnv('TOP_CHUNKS_MAX_CHUNK_TEXT_CHARS', '12000'));
const MAX_TOTAL_CHARS = Number(requireEnv('TOP_CHUNKS_MAX_TOTAL_CHARS', '60000'));

type GetTopChunksRequest = {
  question: string;
  topK?: number;
  projectId?: string;
  includePastPerformance?: boolean; // opt-in flag (default: true)
};

type SemanticResult = {
  chunkKey?: string;
  score: number;
  text: string;
  sourceType?: 'chunk' | 'content_library' | 'past_performance';
};

type PastPerformanceResult = {
  projectId: string;
  score: number;
  title: string;
  client: string;
  description: string;
  technicalApproach?: string | null;
  achievements: string[];
  technologies: string[];
  domain?: string | null;
  naicsCodes: string[];
  value?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  performanceRating?: number | null;
};

type GetTopChunksResponse = {
  question: string;
  topK: number;
  results: SemanticResult[];
  pastPerformance: PastPerformanceResult[];
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

export const getQandA = async (sk?: string) => {
  if (!sk) return '';
  const result = await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);
  return `\nQ: ${result?.question}\nA: ${result?.answer}\n`;
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
    const includePastPerformance = body.includePastPerformance !== false; // default true

    // Resolve project-scoped KB filter
    let kbIds: string[] | undefined;
    if (body.projectId) {
      const linkedKBIds = await getLinkedKBIds(body.projectId);
      if (linkedKBIds.length > 0) {
        kbIds = linkedKBIds;
        console.log(`Project ${body.projectId}: scoping search to ${kbIds.length} linked KBs`);
      } else {
        console.log(`Project ${body.projectId}: no linked KBs, searching all org KBs`);
      }
    }

    // 1) Embed the question once — reuse for all searches
    const embedding = await getEmbedding(question);

    // 2) Run all searches in parallel
    const [questions_hits, chunk_hits, past_perf_hits] = await Promise.all([
      semanticSearchContentLibrary(orgId, embedding, topK, kbIds),
      semanticSearchChunks(orgId, embedding, topK, kbIds),
      includePastPerformance ? semanticSearchPastPerformance(orgId, embedding, topK) : Promise.resolve([]),
    ]);

    // 3) Build document chunk results
    const results: SemanticResult[] = [];
    let totalChars = 0;

    const uniqueHits = uniqueByChunkKey(chunk_hits);
    for (const h of uniqueHits) {
      const chunkKey = h.source?.chunkKey;
      if (!chunkKey) continue;

      const rawText = await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey);
      const text = truncateText(rawText, MAX_CHUNK_TEXT_CHARS);
      if (!text) continue;

      if (totalChars + text.length > MAX_TOTAL_CHARS) break;
      totalChars += text.length;

      results.push({ chunkKey, score: h.score || 0, text, sourceType: 'chunk' });
    }

    // 4) Add content library Q&A results
    for (const h of questions_hits) {
      results.push({
        text: await getQandA(h?.source?.[SK_NAME]),
        score: h.score || 0,
        sourceType: 'content_library',
      });
    }

    // 5) Build past performance results — fetch full project details
    const pastPerformance: PastPerformanceResult[] = [];

    for (const h of past_perf_hits) {
      const projectId = h.source?.projectId as string | undefined;
      if (!projectId) continue;

      try {
        const project = await getPastProject(orgId, projectId);
        if (!project || project.isArchived) continue;

        pastPerformance.push({
          projectId: project.projectId,
          score: h.score || 0,
          title: project.title,
          client: project.client,
          description: project.description,
          technicalApproach: project.technicalApproach,
          achievements: project.achievements,
          technologies: project.technologies,
          domain: project.domain,
          naicsCodes: project.naicsCodes,
          value: project.value,
          startDate: project.startDate,
          endDate: project.endDate,
          performanceRating: project.performanceRating,
        });
      } catch (err) {
        console.warn(`Failed to fetch past project ${projectId}:`, err);
      }
    }

    const resp: GetTopChunksResponse = { question, topK, results, pastPerformance };
    return apiResponse(200, resp);
  } catch (err) {
    console.error('Error in semantic search:', err);
    return apiResponse(500, {
      message: 'Failed to retrieve search results',
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
