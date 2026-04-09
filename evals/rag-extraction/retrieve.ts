/**
 * promptfoo custom provider — RAG retrieval-only pipeline.
 *
 * Tests the quality of retrieved context WITHOUT LLM answer generation.
 * Returns structured output with per-source retrieval details (scores,
 * counts, content) so assertions can evaluate retrieval quality directly.
 *
 * Env vars (loaded via --env-file .env):
 *   PINECONE_API_KEY, PINECONE_INDEX, DOCUMENTS_BUCKET,
 *   BEDROCK_EMBEDDING_MODEL_ID, BEDROCK_REGION, REGION,
 *   DB_TABLE_NAME, ORG_ID
 */

import { Pinecone } from '@pinecone-database/pinecone';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// ─── Config ──────────────────────────────────────────────────────────────────

const ORG_ID = process.env.ORG_ID ?? '';
const PINECONE_API_KEY = process.env.PINECONE_API_KEY ?? '';
const PINECONE_INDEX = process.env.PINECONE_INDEX ?? '';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? '';
const DB_TABLE_NAME = process.env.DB_TABLE_NAME ?? '';
const BEDROCK_REGION =
  process.env.BEDROCK_REGION ?? process.env.REGION ?? 'us-east-1';
const BEDROCK_EMBEDDING_MODEL_ID =
  process.env.BEDROCK_EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';

const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';
const SIMILARITY_THRESHOLD = 0.20;
const TITAN_V2_SAFE_CHARS = 8_000;

// ─── Clients (lazy singletons) ──────────────────────────────────────────────

let pineconeClient: Pinecone | null = null;
let bedrockClient: BedrockRuntimeClient | null = null;
let ddbDocClient: DynamoDBDocumentClient | null = null;
let s3Client: S3Client | null = null;

const getPinecone = (): Pinecone => {
  if (!pineconeClient) pineconeClient = new Pinecone({ apiKey: PINECONE_API_KEY });
  return pineconeClient;
};

const getBedrock = (): BedrockRuntimeClient => {
  if (!bedrockClient)
    bedrockClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  return bedrockClient;
};

const getDdb = (): DynamoDBDocumentClient => {
  if (!ddbDocClient) {
    const raw = new DynamoDBClient({ region: BEDROCK_REGION });
    ddbDocClient = DynamoDBDocumentClient.from(raw);
  }
  return ddbDocClient;
};

const getS3 = (): S3Client => {
  if (!s3Client) s3Client = new S3Client({ region: BEDROCK_REGION });
  return s3Client;
};

// ─── Embedding ──────────────────────────────────────────────────────────────

const getEmbedding = async (text: string): Promise<number[]> => {
  const truncated = text.trim().slice(0, TITAN_V2_SAFE_CHARS);
  const response = await getBedrock().send(
    new InvokeModelCommand({
      modelId: BEDROCK_EMBEDDING_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify({ inputText: truncated })),
    }),
  );
  const result = JSON.parse(new TextDecoder().decode(response.body));
  const vector = result.embedding ?? result.vector;
  if (!vector || !Array.isArray(vector)) {
    throw new Error(`No embedding in Bedrock response: ${Object.keys(result)}`);
  }
  return vector;
};

// ─── Pinecone search ────────────────────────────────────────────────────────

interface PineconeHit {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

const pineconeSearch = async (
  orgId: string,
  embedding: number[],
  k: number,
  type: string,
): Promise<PineconeHit[]> => {
  const pc = getPinecone();
  const index = pc.Index(PINECONE_INDEX);
  const results = await index.namespace(orgId).query({
    vector: embedding,
    topK: k,
    includeMetadata: true,
    includeValues: false,
    filter: { type: { $eq: type } },
  });
  return (results.matches ?? []).map((m) => ({
    id: m.id ?? '',
    score: m.score ?? 0,
    metadata: (m.metadata ?? {}) as Record<string, unknown>,
  }));
};

// ─── S3 loader ──────────────────────────────────────────────────────────────

const loadTextFromS3 = async (bucket: string, key: string): Promise<string> => {
  const res = await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return (await res.Body?.transformToString('utf-8')) ?? '';
};

// ─── DynamoDB loader ────────────────────────────────────────────────────────

const getItem = async (pk: string, sk: string): Promise<Record<string, unknown> | null> => {
  const res = await getDdb().send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: pk, [SK_NAME]: sk },
    }),
  );
  return (res.Item as Record<string, unknown>) ?? null;
};

// ─── Truncate helper ────────────────────────────────────────────────────────

const truncateText = (text: string, maxLen: number): string =>
  text.length <= maxLen ? text : text.slice(0, maxLen) + '…';

// ─── KB Chunks (detailed) ───────────────────────────────────────────────────

interface KbChunkResult {
  index: number;
  score: number;
  docName: string;
  text: string;
}

const retrieveKbChunks = async (
  orgId: string,
  embedding: number[],
  limit = 5,
): Promise<{ chunks: KbChunkResult[]; formatted: string }> => {
  const hits = await pineconeSearch(orgId, embedding, limit * 2, 'chunk');
  const relevant = hits.filter((h) => h.score >= SIMILARITY_THRESHOLD).slice(0, limit);
  if (!relevant.length) return { chunks: [], formatted: '' };

  const chunks: KbChunkResult[] = [];
  for (const [i, h] of relevant.entries()) {
    const chunkKey = h.metadata.chunkKey as string | undefined;
    const text = chunkKey
      ? await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey).catch(() => '')
      : '';
    if (!text.trim()) continue;

    const pk = h.metadata[PK_NAME] as string | undefined;
    const sk = h.metadata[SK_NAME] as string | undefined;
    let docName = '';
    if (pk && sk) {
      const doc = await getItem(pk, sk).catch(() => null);
      docName = (doc?.name as string) ?? '';
    }

    chunks.push({ index: i + 1, score: h.score, docName, text: truncateText(text, 2400) });
  }

  const formatted = chunks
    .map((c) => `[KB ${c.index}] (score: ${c.score.toFixed(2)})${c.docName ? ` — ${c.docName}` : ''}\n${c.text}`)
    .join('\n\n---\n\n');

  return { chunks, formatted };
};

// ─── Past Performance (detailed) ────────────────────────────────────────────

interface PpResult {
  index: number;
  score: number;
  title: string;
  client: string;
  domain: string;
  description: string;
}

const retrievePastPerformance = async (
  orgId: string,
  embedding: number[],
  limit = 3,
): Promise<{ items: PpResult[]; formatted: string }> => {
  const hits = await pineconeSearch(orgId, embedding, limit * 2, 'past_project');
  const relevant = hits.filter((h) => h.score >= SIMILARITY_THRESHOLD).slice(0, limit);
  if (!relevant.length) return { items: [], formatted: '' };

  const items: PpResult[] = [];
  const lines: string[] = [];

  for (const [i, h] of relevant.entries()) {
    const m = h.metadata;
    const item: PpResult = {
      index: i + 1,
      score: h.score,
      title: (m.title as string) ?? '',
      client: (m.client as string) ?? '',
      domain: (m.domain as string) ?? '',
      description: truncateText(String(m.description ?? ''), 600),
    };
    items.push(item);

    const parts: string[] = [`[PP ${i + 1}] (score: ${h.score.toFixed(2)})`];
    if (m.title) parts.push(`Project: ${m.title}`);
    if (m.client) parts.push(`Client: ${m.client}`);
    if (m.domain) parts.push(`Domain: ${m.domain}`);
    if (m.value) parts.push(`Value: $${m.value}`);
    if (m.description) parts.push(`Description: ${item.description}`);
    if (Array.isArray(m.technologies) && m.technologies.length) {
      parts.push(`Technologies: ${(m.technologies as string[]).slice(0, 6).join(', ')}`);
    }
    if (Array.isArray(m.achievements) && m.achievements.length) {
      parts.push('Achievements:');
      (m.achievements as string[]).slice(0, 3).forEach((a) => parts.push(`  • ${a}`));
    }
    lines.push(parts.join('\n'));
  }

  return { items, formatted: lines.join('\n\n---\n\n') };
};

// ─── Content Library (detailed) ─────────────────────────────────────────────

interface ClResult {
  index: number;
  score: number;
  question: string;
  answer: string;
}

const retrieveContentLibrary = async (
  orgId: string,
  embedding: number[],
  limit = 3,
): Promise<{ items: ClResult[]; formatted: string }> => {
  const hits = await pineconeSearch(orgId, embedding, limit * 2, 'content_library');
  const relevant = hits.filter((h) => h.score >= SIMILARITY_THRESHOLD).slice(0, limit);
  if (!relevant.length) return { items: [], formatted: '' };

  const items: ClResult[] = [];
  const lines: string[] = [];

  for (const [i, hit] of relevant.entries()) {
    const pk = hit.metadata[PK_NAME] as string | undefined;
    const sk = hit.metadata[SK_NAME] as string | undefined;
    if (!pk || !sk) continue;

    const item = await getItem(pk, sk).catch(() => null);
    if (!item?.question || !item?.answer) continue;

    const clItem: ClResult = {
      index: i + 1,
      score: hit.score,
      question: String(item.question),
      answer: truncateText(String(item.answer), 800),
    };
    items.push(clItem);
    lines.push(`[CL ${i + 1}] (score: ${hit.score.toFixed(2)})\nQ: ${clItem.question}\nA: ${clItem.answer}`);
  }

  return { items, formatted: lines.join('\n\n---\n\n') };
};

// ─── promptfoo entry point ──────────────────────────────────────────────────

class RetrievalProvider {
  id = () => 'rag-extraction';

  callApi = async (prompt: string): Promise<{ output: string; error?: string }> => {
    const query = prompt.trim();
    if (!query) return { output: '', error: 'Empty query' };

    try {
      const embedding = await getEmbedding(query);

      const [kb, pp, cl] = await Promise.all([
        retrieveKbChunks(ORG_ID, embedding, 5),
        retrievePastPerformance(ORG_ID, embedding, 3),
        retrieveContentLibrary(ORG_ID, embedding, 3),
      ]);

      // Build structured output for assertions
      const allScores = [
        ...kb.chunks.map((c) => c.score),
        ...pp.items.map((p) => p.score),
        ...cl.items.map((c) => c.score),
      ];
      const totalResults = kb.chunks.length + pp.items.length + cl.items.length;
      const avgScore = allScores.length
        ? allScores.reduce((a, b) => a + b, 0) / allScores.length
        : 0;
      const maxScore = allScores.length ? Math.max(...allScores) : 0;

      // Human-readable output with machine-parseable header
      const header = [
        `RETRIEVAL_SUMMARY`,
        `total_results: ${totalResults}`,
        `kb_chunks: ${kb.chunks.length}`,
        `pp_items: ${pp.items.length}`,
        `cl_items: ${cl.items.length}`,
        `avg_score: ${avgScore.toFixed(3)}`,
        `max_score: ${maxScore.toFixed(3)}`,
        `top_scores: [${allScores.sort((a, b) => b - a).slice(0, 5).map((s) => s.toFixed(2)).join(', ')}]`,
      ].join('\n');

      const sections: string[] = [];
      if (kb.formatted) sections.push(`=== Knowledge Base (${kb.chunks.length} chunks) ===\n${kb.formatted}`);
      else sections.push('=== Knowledge Base ===\nNo relevant KB chunks found.');
      if (pp.formatted) sections.push(`=== Past Performance (${pp.items.length} projects) ===\n${pp.formatted}`);
      else sections.push('=== Past Performance ===\nNo relevant past performance found.');
      if (cl.formatted) sections.push(`=== Content Library (${cl.items.length} items) ===\n${cl.formatted}`);
      else sections.push('=== Content Library ===\nNo relevant content library items found.');

      const output = `${header}\n\n${sections.join('\n\n')}`;
      return { output };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  };
}

export default RetrievalProvider;
