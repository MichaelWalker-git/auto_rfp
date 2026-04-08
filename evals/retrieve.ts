/**
 * promptfoo custom provider — self-contained retrieval pipeline.
 *
 * Replicates the Lambda RAG retrieval (embed → Pinecone → S3) without
 * importing from apps/functions (avoids @/ path alias issues).
 *
 * Env vars (loaded via --env-file .env):
 *   PINECONE_API_KEY, PINECONE_INDEX, DOCUMENTS_BUCKET,
 *   BEDROCK_EMBEDDING_MODEL_ID, BEDROCK_REGION, REGION,
 *   DB_TABLE_NAME, ORG_ID
 */

import { Pinecone } from '@pinecone-database/pinecone';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// ─── Config ──────────────────────────────────────────────────────────────────

const ORG_ID = process.env.ORG_ID ?? '';
const PINECONE_API_KEY = process.env.PINECONE_API_KEY ?? '';
const PINECONE_INDEX = process.env.PINECONE_INDEX ?? '';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? '';
const DB_TABLE_NAME = process.env.DB_TABLE_NAME ?? '';
const BEDROCK_REGION = process.env.BEDROCK_REGION ?? process.env.REGION ?? 'us-east-1';
const BEDROCK_MODEL_ID = process.env.BEDROCK_EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';

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
  if (!bedrockClient) bedrockClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });
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
      modelId: BEDROCK_MODEL_ID,
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

  return (results.matches ?? []).map(m => ({
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

// ─── KB Chunks ──────────────────────────────────────────────────────────────

const retrieveKbChunks = async (orgId: string, embedding: number[], limit = 5): Promise<string> => {
  const hits = await pineconeSearch(orgId, embedding, limit * 2, 'chunk');
  const relevant = hits.filter(h => h.score >= SIMILARITY_THRESHOLD).slice(0, limit);
  if (!relevant.length) return '';

  const chunks = await Promise.all(
    relevant.map(async (h, i) => {
      const chunkKey = h.metadata.chunkKey as string | undefined;
      const text = chunkKey ? await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey).catch(() => '') : '';
      if (!text.trim()) return null;

      const pk = h.metadata[PK_NAME] as string | undefined;
      const sk = h.metadata[SK_NAME] as string | undefined;
      let docName = '';
      if (pk && sk) {
        const doc = await getItem(pk, sk).catch(() => null);
        docName = (doc?.name as string) ?? '';
      }

      return `[KB ${i + 1}] (score: ${h.score.toFixed(2)})${docName ? ` — ${docName}` : ''}\n${truncateText(text, 2400)}`;
    }),
  );

  return chunks.filter((c): c is string => c !== null).join('\n\n---\n\n');
};

// ─── Past Performance ───────────────────────────────────────────────────────

const retrievePastPerformance = async (orgId: string, embedding: number[], limit = 3): Promise<string> => {
  const hits = await pineconeSearch(orgId, embedding, limit * 2, 'past_project');
  const relevant = hits.filter(h => h.score >= SIMILARITY_THRESHOLD).slice(0, limit);
  if (!relevant.length) return '';

  const formatted = relevant.map((h, i) => {
    const m = h.metadata;
    const lines: string[] = [`[PP ${i + 1}] (score: ${h.score.toFixed(2)})`];
    if (m.title) lines.push(`Project: ${m.title}`);
    if (m.client) lines.push(`Client: ${m.client}`);
    if (m.domain) lines.push(`Domain: ${m.domain}`);
    if (m.value) lines.push(`Value: $${m.value}`);
    if (m.description) lines.push(`Description: ${truncateText(String(m.description), 600)}`);
    if (Array.isArray(m.technologies) && m.technologies.length) {
      lines.push(`Technologies: ${(m.technologies as string[]).slice(0, 6).join(', ')}`);
    }
    if (Array.isArray(m.achievements) && m.achievements.length) {
      lines.push('Achievements:');
      (m.achievements as string[]).slice(0, 3).forEach(a => lines.push(`  • ${a}`));
    }
    return lines.join('\n');
  });

  return formatted.join('\n\n---\n\n');
};

// ─── Content Library ────────────────────────────────────────────────────────

const retrieveContentLibrary = async (orgId: string, embedding: number[], limit = 3): Promise<string> => {
  const hits = await pineconeSearch(orgId, embedding, limit * 2, 'content_library');
  const relevant = hits.filter(h => h.score >= SIMILARITY_THRESHOLD).slice(0, limit);
  if (!relevant.length) return '';

  const items: string[] = [];
  for (const [i, hit] of relevant.entries()) {
    const pk = hit.metadata[PK_NAME] as string | undefined;
    const sk = hit.metadata[SK_NAME] as string | undefined;
    if (!pk || !sk) continue;

    const item = await getItem(pk, sk).catch(() => null);
    if (!item?.question || !item?.answer) continue;

    items.push(
      `[CL ${i + 1}] (score: ${hit.score.toFixed(2)})\nQ: ${item.question}\nA: ${truncateText(String(item.answer), 800)}`,
    );
  }

  return items.join('\n\n---\n\n');
};

// ─── promptfoo entry point ──────────────────────────────────────────────────

class RetrievalProvider {
  id = () => 'rag-retrieval';

  callApi = async (prompt: string): Promise<{ output: string; error?: string }> => {
    const query = prompt.trim();
    if (!query) return { output: '', error: 'Empty query' };

    try {
      const embedding = await getEmbedding(query);

      const [kbContext, ppContext, clContext] = await Promise.all([
        retrieveKbChunks(ORG_ID, embedding, 5),
        retrievePastPerformance(ORG_ID, embedding, 3),
        retrieveContentLibrary(ORG_ID, embedding, 3),
      ]);

      const sections: string[] = [];
      if (kbContext) sections.push(`=== Knowledge Base ===\n${kbContext}`);
      if (ppContext) sections.push(`=== Past Performance ===\n${ppContext}`);
      if (clContext) sections.push(`=== Content Library ===\n${clContext}`);

      const combined = sections.length ? sections.join('\n\n') : 'No relevant context found.';
      return { output: combined };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  };
}

export default RetrievalProvider;
