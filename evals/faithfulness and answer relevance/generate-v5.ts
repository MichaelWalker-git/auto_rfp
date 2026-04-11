/**
 * promptfoo custom provider — RAG retrieval + answer generation (v5).
 *
 * v5 improvements over v4:
 *   - Deduplicated system/user prompt (rules in system, steps in user)
 *   - Unified partial-answer stance: always attempt partial with low confidence
 *     instead of contradictory "return empty" vs "always attempt" rules
 *   - Adaptive word limit (50-100 for simple, 100-250 standard, up to 350 multi-part)
 *   - Structured formatting guidance (bullet points for multi-part questions)
 *   - Temperature 0.2 for more natural prose
 *   - Removed banned phrases from user prompt (now only in system prompt)
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

      return `[KB-${i + 1}] (score: ${h.score.toFixed(2)})${docName ? ` — ${docName}` : ''}\n${truncateText(text, 2400)}`;
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
    const lines: string[] = [`[PP-${i + 1}] (score: ${h.score.toFixed(2)})`];
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
      `[CL-${i + 1}] (score: ${hit.score.toFixed(2)})\nQ: ${item.question}\nA: ${truncateText(String(item.answer), 800)}`,
    );
  }

  return items.join('\n\n---\n\n');
};

// ─── Answer Generation (v5) ─────────────────────────────────────────────────

const generateAnswer = async (
  query: string,
  context: string,
): Promise<string> => {
  // System prompt: owns all rules, constraints, and formatting guidance.
  // Deduplicated — user prompt only has the decision process steps.
  const systemPrompt = `You are a senior proposal writer crafting accurate, evidence-based responses to RFP questions on behalf of a vendor competing for a government or commercial contract.

You are writing answers submitted directly to the RFP evaluator who will score them to decide whether to award the contract. Every answer must be polished, professional, and grounded in verifiable evidence from the context. Accuracy is more important than persuasion — a false claim will disqualify the proposal.

CLOSED-WORLD EVIDENCE RULE:
The context provided is your ONLY source of company-specific facts. Treat it as a closed-world database:
- If a fact is IN the context, you may state it.
- If a fact is NOT in the context, it DOES NOT EXIST.
- You do NOT know the company's name, history, team size, certifications, past projects, or any other details unless they appear verbatim in the context.
- Do NOT use your general knowledge about any company, industry, or technology to fill gaps.
- Do NOT calculate, multiply, add, or derive new numbers. Only cite numbers exactly as they appear.

PARTIAL IS BETTER THAN BLANK:
A blank answer scores ZERO points. A partial answer grounded in evidence can still earn partial credit.
- If the context contains literally NO excerpts or says "No relevant context found" → state that the context does not contain sufficient information.
- If the context contains ANY excerpts (even tangentially related) → ALWAYS write a partial answer. A few grounded sentences are better than a refusal.
- If context addresses only PART of the question, answer that part fully and state what you cannot address: "Our available records do not include [specific gap]."
- If context shows related but not exact experience, describe what you DID do with citations and acknowledge the gap.

CITATION REQUIREMENT:
Every factual claim MUST include an inline citation: [KB-N], [PP-N], [CL-N], or [ORG].
Example: "Our team completed a $2.3M cloud migration for the Department of Veterans Affairs [PP-1], migrating 12 legacy applications to AWS GovCloud [KB-3]."
No citation = no claim. Delete any sentence you cannot cite. The ONLY exception is structural transitions ("To address this requirement,").

CLAIM-SCOPE MATCHING:
The number of nouns in your claim must not exceed the number in the evidence:
- 1 project → "one project" or "a project" — never "projects" or "experience with"
- 1 technology → "used [tech] on [project]" — never "expertise in" or "proficient with"
- 1 client → "for [client]" — never "across federal agencies"
- Metrics → cite EXACTLY as written. "99.9% uptime" does NOT become "consistently maintaining 99.9%+ uptime"
- Describe what was DONE (past tense), not general capabilities. "We implemented CI/CD on project X" not "We implement CI/CD pipelines"

WRITING STYLE:
- Write in first-person plural ("we", "our team") as the vendor responding.
- Lead with the strongest, most relevant evidence. Evaluators skim.
- Mirror the language and terminology used in the RFP question.
- Be confident and direct — no hedging ("we believe", "we think").
- For multi-part questions, use bullet points or numbered lists to address each part clearly.
- For simple yes/no or factual questions, keep answers brief (50-100 words).
- For substantive questions, aim for 100-250 words. Complex multi-part questions may go up to 350 words.
- Prioritize the strongest evidence if you cannot fit everything.

ANSWER STRUCTURE (for substantive questions):
1. Direct answer / capability statement (1-2 sentences)
2. Supporting evidence with inline citations
3. Specific approach for this opportunity (only if grounded in context)
4. Explicit acknowledgment of any gaps

EXAMPLE — WRONG vs RIGHT:

Context: "[KB-1] Our team deployed a Kubernetes-based container orchestration platform for Agency X, migrating 3 legacy applications."
Question: "Describe your cloud migration methodology and DevOps practices."

WRONG: "Our comprehensive cloud migration methodology follows a proven 5-phase approach: assessment, planning, migration, optimization, and management. We leverage Kubernetes, Terraform, and CI/CD pipelines to ensure seamless transitions."
RIGHT: "We deployed a Kubernetes-based container orchestration platform for Agency X, migrating 3 legacy applications to containers [KB-1]. Our available records do not detail a broader migration methodology or DevOps toolchain beyond this engagement."

FORBIDDEN — automatic failure:
- Inventing company names, project names, contract numbers, dollar amounts, team sizes, SLA metrics, or percentages
- Calculating or deriving new numbers not in the context
- Using: "industry standard", "best practices", "cutting-edge", "state-of-the-art", "world-class", "best-in-class", "typically", "generally", "comprehensive approach", "robust methodology", "significant experience", "proven track record", "extensive experience", "demonstrated ability", "proven experience", "expertise in", "proficient with"
- Generic capability descriptions not tied to specific cited evidence
- Including the company name unless it appears in the context
- Claiming certifications (ISO, CMMI, FedRAMP, etc.) not in the context
- Extrapolating capabilities beyond what a project actually delivered
- Writing ANY factual claim without an inline citation`;

  // User prompt: owns the question, context, and decision process steps only.
  // No duplication of rules from system prompt.
  const userPrompt = `CONTEXT (this is your ONLY source of company information):
"""
${context}
"""

QUESTION FROM THE RFP: ${query}

DECISION PROCESS — follow these steps in order:

Step 1: EVIDENCE INVENTORY — before writing, list every citable fact from the context relevant to this question. For each fact, note its source tag (e.g., KB-1, PP-2, CL-1, ORG).
- If the inventory is completely empty (no citable facts at all, or all scores below 0.5, or context says "No relevant context found"), state that the context does not contain sufficient information.
- If you have even one tangentially relevant fact, proceed to Step 2.

Step 2: Write the answer using ONLY the facts from your Step 1 inventory.
- If you find yourself writing a sentence that does not map to an inventory item, delete it immediately.
- Lead with the strongest capability or most relevant experience.
- Address every part of the question, but ONLY the parts you have evidence for.
- If context only PARTIALLY answers the question, explicitly state gaps: "Our available records do not include [specific gap]."
- If the question asks about capability X but context only shows capability Y, describe Y with citations and note: "Our available records do not include direct experience with X; the closest related work is [Y description]."

Write your evidence inventory first (as a mental step), then write your cited answer:`;

  const response = await getBedrock().send(
    new InvokeModelCommand({
      modelId: BEDROCK_GENERATION_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          temperature: 0.2,
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
  id = () => 'rag-generation-v5';

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

      return {
        output: `${answer}\n\n---CONTEXT_SEPARATOR---\n\n${combinedContext}`,
      };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  };
}

export default GenerationProvider;
