/**
 * promptfoo custom provider — RAG retrieval + answer generation.
 *
 * Retrieves context via the same pipeline as the retrieval eval,
 * then generates an answer using Claude via Bedrock.
 * Returns structured output so context-faithfulness can extract both.
 *
 * Env vars (loaded via --env-file .env):
 *   PINECONE_API_KEY, PINECONE_INDEX, DOCUMENTS_BUCKET,
 *   BEDROCK_EMBEDDING_MODEL_ID, BEDROCK_REGION, REGION,
 *   DB_TABLE_NAME, ORG_ID, BEDROCK_GENERATION_MODEL_ID
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
const BEDROCK_GENERATION_MODEL_ID =
  process.env.BEDROCK_GENERATION_MODEL_ID ??
  'us.anthropic.claude-sonnet-4-6';

const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';
const SIMILARITY_THRESHOLD = 0.2;
const TITAN_V2_SAFE_CHARS = 8_000;

// ─── Clients (lazy singletons) ──────────────────────────────────────────────

let pineconeClient: Pinecone | null = null;
let bedrockClient: BedrockRuntimeClient | null = null;
let ddbDocClient: DynamoDBDocumentClient | null = null;
let s3Client: S3Client | null = null;

const getPinecone = (): Pinecone => {
  if (!pineconeClient)
    pineconeClient = new Pinecone({ apiKey: PINECONE_API_KEY });
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
    throw new Error(
      `No embedding in Bedrock response: ${Object.keys(result)}`,
    );
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

const loadTextFromS3 = async (
  bucket: string,
  key: string,
): Promise<string> => {
  const res = await getS3().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  return (await res.Body?.transformToString('utf-8')) ?? '';
};

// ─── DynamoDB loader ────────────────────────────────────────────────────────

const getItem = async (
  pk: string,
  sk: string,
): Promise<Record<string, unknown> | null> => {
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

const retrieveKbChunks = async (
  orgId: string,
  embedding: number[],
  limit = 5,
): Promise<string> => {
  const hits = await pineconeSearch(orgId, embedding, limit * 2, 'chunk');
  const relevant = hits
    .filter((h) => h.score >= SIMILARITY_THRESHOLD)
    .slice(0, limit);
  if (!relevant.length) return '';

  const chunks = await Promise.all(
    relevant.map(async (h, i) => {
      const chunkKey = h.metadata.chunkKey as string | undefined;
      const text = chunkKey
        ? await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey).catch(() => '')
        : '';
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

const retrievePastPerformance = async (
  orgId: string,
  embedding: number[],
  limit = 3,
): Promise<string> => {
  const hits = await pineconeSearch(
    orgId,
    embedding,
    limit * 2,
    'past_project',
  );
  const relevant = hits
    .filter((h) => h.score >= SIMILARITY_THRESHOLD)
    .slice(0, limit);
  if (!relevant.length) return '';

  const formatted = relevant.map((h, i) => {
    const m = h.metadata;
    const lines: string[] = [`[PP ${i + 1}] (score: ${h.score.toFixed(2)})`];
    if (m.title) lines.push(`Project: ${m.title}`);
    if (m.client) lines.push(`Client: ${m.client}`);
    if (m.domain) lines.push(`Domain: ${m.domain}`);
    if (m.value) lines.push(`Value: $${m.value}`);
    if (m.description)
      lines.push(`Description: ${truncateText(String(m.description), 600)}`);
    if (Array.isArray(m.technologies) && m.technologies.length) {
      lines.push(
        `Technologies: ${(m.technologies as string[]).slice(0, 6).join(', ')}`,
      );
    }
    if (Array.isArray(m.achievements) && m.achievements.length) {
      lines.push('Achievements:');
      (m.achievements as string[])
        .slice(0, 3)
        .forEach((a) => lines.push(`  • ${a}`));
    }
    return lines.join('\n');
  });

  return formatted.join('\n\n---\n\n');
};

// ─── Content Library ────────────────────────────────────────────────────────

const retrieveContentLibrary = async (
  orgId: string,
  embedding: number[],
  limit = 3,
): Promise<string> => {
  const hits = await pineconeSearch(
    orgId,
    embedding,
    limit * 2,
    'content_library',
  );
  const relevant = hits
    .filter((h) => h.score >= SIMILARITY_THRESHOLD)
    .slice(0, limit);
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

// ─── Answer Generation ──────────────────────────────────────────────────────

const generateAnswer = async (
  query: string,
  context: string,
): Promise<string> => {
  const systemPrompt = `You are a senior proposal writer crafting accurate, evidence-based responses to RFP questions on behalf of a vendor competing for a government or commercial contract.

YOUR ROLE: You are writing answers that will be submitted directly to the RFP evaluator. Every answer must be polished, professional, and grounded in verifiable evidence from the context. Accuracy is more important than persuasion — a false claim will disqualify the proposal.

ABSOLUTE RULE — CONTEXT IS YOUR ONLY SOURCE OF TRUTH:
You will receive context containing company-specific information. This context is the ONLY facts you may use. Treat it as a closed-world database:
- If a fact is IN the context, you may state it.
- If a fact is NOT in the context, it DOES NOT EXIST. Do not infer, assume, or supplement.
- You do NOT know the company's name, history, team size, certifications, past projects, or any other details unless they appear verbatim in the context.
- Do NOT use your general knowledge about any company, industry, or technology to fill gaps.

WHEN CONTEXT CONTAINS NO RELEVANT COMPANY-SPECIFIC INFORMATION:
This includes when context says "No relevant context found" or similarity scores are all below 0.5.
You MUST respond with a brief, factual statement that the provided context does not contain sufficient information to answer this question. Do NOT fabricate an answer. Do NOT elaborate on what information would be needed.

WHEN CONTEXT CONTAINS RELEVANT COMPANY-SPECIFIC INFORMATION:
Write a compelling, evidence-based response following these standards:
- Write in first-person plural ("we", "our team", "our company") as the vendor responding to the RFP.
- Every claim MUST be traceable to a specific passage in the context.
- Only include numbers, metrics, dates, project names, certifications, and team details that appear verbatim in the context.
- Mirror the language and terminology used in the RFP question itself.
- Address ALL parts of multi-part questions.
- Keep answers concise — 100-250 words maximum. Only include what you can directly support with evidence.
- Use professional, confident tone. Avoid hedging ("we believe", "we think") — state capabilities directly.
- SCOPE CLAIMS TO EVIDENCE: If the context mentions one project, say "we completed one project" — never "significant experience", "proven track record", "extensive experience", or "demonstrated ability". The number of examples in the context is the number you can claim.

FORBIDDEN — any of these in your answer means automatic failure:
- Inventing company names, project names, contract numbers, or dollar amounts
- Fabricating team sizes, years of experience, SLA metrics, or percentages
- Calculating or deriving new numbers — only cite numbers that appear exactly as written in the context
- Using phrases: "best practices", "industry standard", "cutting-edge", "state-of-the-art", "world-class", "best-in-class", "typically", "generally"
- Writing generic capability descriptions not tied to specific context evidence
- Including the company name unless it appears in the context
- Making claims about certifications unless they appear in the context
- Saying "significant experience", "proven track record", "extensive experience", "demonstrated ability", or "proven experience" when the context shows only one or two examples
- Extrapolating capabilities beyond what a specific project actually delivered (e.g., a document processing project does not prove cloud migration capability)
- Adapting experience from one domain to answer questions about a different domain (e.g., IT services experience does NOT prove cargo/logistics capability; software development does NOT prove construction management experience). If the context shows experience in domain X but the question asks about domain Y, this is NOT evidence — respond that the context lacks relevant information.

DOMAIN MISMATCH RULE — CRITICAL:
If the question asks about a specific industry, skill, or capability (e.g., "airline cargo delivery", "medical device manufacturing", "bridge construction") and the context contains NO evidence of experience in that specific area, you MUST respond that the context does not contain relevant information. Do NOT adapt unrelated experience to fit the question. Do NOT write generic answers about "our team's ability to adapt". Having experience in one field is NOT evidence of capability in another field.`;

  const userPrompt = `CONTEXT (this is your ONLY source of company information):
"""
${context}
"""

QUESTION FROM THE RFP: ${query}

DECISION PROCESS — follow these steps in order:

Step 1: Check if the context contains ANY company-specific information relevant to this question.
- "No relevant context found" = NO information
- Excerpts about unrelated topics = NO relevant information
- All similarity scores below 0.5 = NO relevant information
- If NO relevant company-specific information exists, STOP and state that the context does not contain relevant information to answer this question.

Step 2: If relevant information exists, identify every specific fact you can cite:
- Extract exact project names, contract details, metrics, certifications, and team details FROM the context
- Do NOT add any facts from your own knowledge — only what is written in the context above
- Do NOT calculate, multiply, add, or derive any new numbers

Step 3: Write the answer using ONLY the facts identified in Step 2.
- Write as "we" / "our team" — this is our company's official response
- Every sentence must be supportable by a specific excerpt from the context
- If the context only partially answers the question, only answer the parts you have evidence for — do not fill gaps with generic content
- Do not generalize from a single example. One project does not mean "significant experience" or "extensive track record". Only claim the scope the evidence supports
- If the question asks about capability X but the context only shows capability Y, this is NOT evidence of X. State that the context lacks relevant information. Do NOT adapt Y to answer a question about X.
- DOMAIN MISMATCH: If the question asks about a specific industry or skill (e.g., "cargo delivery", "medical devices", "construction") and the context shows experience in a DIFFERENT industry, state that the context lacks relevant information. Experience in one field does NOT prove capability in another.
- Keep the answer under 250 words

BANNED PHRASES — do NOT use any of these:
"best practices", "industry standard", "industry-standard", "cutting-edge", "state-of-the-art", "world-class", "best-in-class", "typically", "generally", "we believe", "we think", "significant experience", "proven track record", "extensive experience", "demonstrated ability", "proven experience"

REMINDER: If the context has low similarity scores (below 0.5), or the excerpts are about a different topic/domain than the question, or context shows LOW RELEVANCE WARNING headers, treat that as NO relevant information and state that the context lacks relevant information.

Write your answer now (or state that the context lacks relevant information if none exists):`;

  const response = await getBedrock().send(
    new InvokeModelCommand({
      modelId: BEDROCK_GENERATION_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          messages: [{ role: 'user', content: userPrompt }],
          system: systemPrompt,
        }),
      ),
    }),
  );

  const result = JSON.parse(new TextDecoder().decode(response.body));
  return result.content?.[0]?.text ?? '';
};

// ─── promptfoo entry point ──────────────────────────────────────────────────

class GenerationProvider {
  id = () => 'rag-generation';

  callApi = async (
    prompt: string,
  ): Promise<{ output: string; error?: string }> => {
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

      const combinedContext = sections.length
        ? sections.join('\n\n')
        : 'No relevant context found.';

      const answer = await generateAnswer(query, combinedContext);

      // Return answer as string output. Embed context in a parseable
      // delimiter block so contextTransform can extract it.
      return {
        output: `${answer}\n\n---CONTEXT_SEPARATOR---\n\n${combinedContext}`,
      };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  };
}

export default GenerationProvider;
