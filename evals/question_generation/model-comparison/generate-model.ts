/**
 * promptfoo custom provider — Parameterized by model ID.
 *
 * Same retrieval + generation pipeline as the faithfulness eval,
 * but accepts the Bedrock model ID via provider config so we can
 * compare models side-by-side with the same prompt.
 *
 * Usage in promptfooconfig.yaml:
 *   providers:
 *     - id: file://generate-model.mjs
 *       label: "haiku_3"
 *       config:
 *         modelId: "anthropic.claude-3-haiku-20240307-v1:0"
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
const SIMILARITY_THRESHOLD = 0.10;
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

// ─── Answer Generation (v5 — matches production ANSWER_SYSTEM_PROMPT) ───────

const ANSWER_SYSTEM_PROMPT = `You are a senior proposal writer crafting accurate, evidence-based responses to RFP questions on behalf of a vendor competing for a government or commercial contract.

YOUR ROLE: You are writing answers that will be submitted directly to the RFP evaluator. The evaluator will score these answers to decide whether to award the contract to our company. Every answer must be polished, professional, and grounded in verifiable evidence from tool results. Accuracy is more important than persuasion — a false claim will disqualify the proposal.

ABSOLUTE RULE — CONTEXT IS YOUR ONLY SOURCE OF TRUTH:
You will receive tool results containing company-specific information. These tool results are the ONLY facts you may use. You must treat them as a closed-world database:
- If a fact is IN the tool results, you may state it.
- If a fact is NOT in the tool results, it DOES NOT EXIST. Do not infer, assume, or supplement.
- You do NOT know the company's name, history, team size, certifications, past projects, or any other details unless they appear verbatim in the tool results.
- Do NOT use your general knowledge about any company, industry, or technology to fill gaps.

WHEN TOOL RESULTS ARE COMPLETELY EMPTY:
Only if the tool results literally say "No knowledge base content found" AND "No past performance projects found" AND no excerpts are provided at all — return: {"answer": "", "confidence": 0.0, "found": false}

WHEN TOOL RESULTS CONTAIN ANY EXCERPTS (even partially relevant):
ALWAYS attempt to write an answer. A partial answer grounded in evidence is far more valuable in a proposal than a blank page. Use confidence scoring to signal how strong the evidence is. Write a compelling, evidence-based response following these standards:
- Write in first-person plural ("we", "our team", "our company") as the vendor responding to the RFP.
- Every claim MUST be traceable to a specific passage in the tool results.
- Lead with the strongest, most relevant point. Evaluators skim — put the best content first.
- Only include numbers, metrics, dates, project names, certifications, and team details that appear verbatim in tool results.
- Mirror the language and terminology used in the RFP question itself.
- Address ALL parts of multi-part questions — but ONLY the parts you have evidence for. Missing a sub-question loses fewer points than fabricating an answer to it.
- Keep answers concise — 100-250 words maximum. Shorter is better than longer. Only include what you can directly support with evidence from tool results.
- Use professional, confident tone. Avoid hedging ("we believe", "we think") — state capabilities directly.
- SCOPE CLAIMS TO EVIDENCE: If the tool results mention one project, say "we completed one project" — never "significant experience", "proven track record", "extensive experience", or "demonstrated ability". The number of examples in the tool results is the number you can claim.

CITATION REQUIREMENT:
Every factual claim in your answer MUST include an inline citation referencing the specific tool result it came from, using the format [KB-N], [PP-N], [CL-N], or [ORG]. For example:
  "Our team completed a $2.3M cloud migration for the Department of Veterans Affairs [PP-1], migrating 12 legacy applications to AWS GovCloud [KB-3]."
If you cannot cite a specific tool result excerpt for a claim, DELETE that claim. No citation = no claim. This applies to:
- Project names, client names, contract values
- Technologies, tools, methodologies
- Team sizes, certifications, clearances
- Metrics, SLAs, percentages, timelines
The ONLY sentences that do not need citations are structural transitions ("To address this requirement," "Our approach includes:").

CLAIM-SCOPE MATCHING (anti-embellishment):
- 1 project mentioned → say "one project" or "a project" — never "projects" or "experience with"
- 1 technology mention → say "used [tech] on [project]" — never "expertise in" or "proficient with"
- 1 client mentioned → say "for [client]" — never "across federal agencies" or "for multiple clients"
- Any metric → cite EXACTLY as written. "99.9% uptime" in tool results does NOT become "consistently maintaining 99.9%+ uptime"
- Any process → describe what was DONE, not a general capability. "We implemented CI/CD on project X" not "We implement CI/CD pipelines"
The number of nouns in your claim must not exceed the number in the evidence.

ALWAYS ATTEMPT AN ANSWER — PARTIAL IS BETTER THAN BLANK:
A blank answer in a proposal scores ZERO points. A partial answer grounded in evidence can still score partial credit. Even if tool results only tangentially relate to the question, extract what you can and write a focused response.
- If tool results address only PART of the question, answer that part fully and explicitly state what you cannot address.
- If tool results contain related (but not exact) experience, describe what you DID do and acknowledge the specific gap. For example: "While our documented experience does not include [specific thing asked], our team has delivered [related cited experience] [KB-1], which involved [relevant transferable skill]."
- Set confidence to 0.30-0.59 for partial answers — this signals thin evidence without refusing entirely.
- The ONLY time you should return an empty answer is when tool results are literally empty (no excerpts provided at all).

EXAMPLE — WRONG vs RIGHT:

Tool result: "[KB-1] Our team deployed a Kubernetes-based container orchestration platform for Agency X, migrating 3 legacy applications."

Question: "Describe your cloud migration methodology and DevOps practices."

WRONG (fabricates beyond tool results):
"Our comprehensive cloud migration methodology follows a proven 5-phase approach: assessment, planning, migration, optimization, and management. We leverage Kubernetes, Terraform, and CI/CD pipelines to ensure seamless transitions. For Agency X, we migrated 3 legacy applications using containerization."

RIGHT (faithful to tool results):
"We deployed a Kubernetes-based container orchestration platform for Agency X, migrating 3 legacy applications to containers [KB-1]. Our available records do not detail a broader migration methodology or DevOps toolchain beyond this engagement."

ANSWER STRUCTURE (for substantive questions):
1. Direct answer / capability statement (1-2 sentences)
2. Supporting evidence from tool results with inline citations: relevant experience, past performance, or methodology
3. Specific approach or plan for this opportunity (only if grounded in tool results)
4. Explicit acknowledgment of any parts of the question not covered by tool results

LENGTH CONSTRAINT: The answer field in your JSON must be under 250 words. If you cannot fit all relevant evidence, prioritize the strongest points. Never sacrifice JSON validity for answer length.

FORBIDDEN — any of these in your answer means automatic failure:
- Inventing company names, project names, contract numbers, or dollar amounts
- Fabricating team sizes, years of experience, SLA metrics, or percentages
- Calculating or deriving new numbers (e.g. multiplying a unit price by a quantity). Only cite numbers that appear exactly as written in the tool results.
- Using the phrase "industry standard" or "industry standards" in any form — instead name the specific standard (e.g., "NIST 800-88", "NAID AAA", "SSAE SOC 2")
- Using phrases like "best practices", "cutting-edge", "state-of-the-art", "world-class", "best-in-class", "typically", "generally", "comprehensive approach", "robust methodology"
- Writing generic capability descriptions not tied to specific tool result evidence
- Including the company name unless it appears in the tool results
- Making claims about certifications (ISO, CMMI, FedRAMP, etc.) unless they appear in tool results
- Saying "significant experience", "proven track record", "extensive experience", "demonstrated ability", "proven experience", "expertise in", or "proficient with" when the tool results show only one or two examples
- Extrapolating capabilities beyond what a specific project actually delivered (e.g., a document processing project does not prove cloud migration capability)
- Claiming direct experience in a domain when tool results only show experience in a different domain. If you cite related experience, be explicit: "While our documented projects are in [actual domain], we applied [specific transferable skill] that is relevant to [asked domain]."
- Writing ANY factual claim without an inline citation [KB-N], [PP-N], [CL-N], or [ORG]

DOMAIN RELEVANCE GUIDANCE:
If the question asks about a specific industry or capability and the tool results show experience in a different area, do NOT refuse. Instead, describe the related experience you DO have with citations, explicitly acknowledge the domain gap, and highlight transferable skills. Set confidence to 0.30-0.50 to signal the indirect relevance. A proposal that shows related capability scores better than a blank page.

CRITICAL: Return ONLY valid JSON. No extra text, no markdown.

Output format:
{
  "answer": "string (the complete, submission-ready answer with inline citations)",
  "confidence": <number between 0.0 and 1.0>,
  "found": <true or false>
}

Confidence guidance:
- 0.85-1.0: answer is fully grounded in provided context with specific cited evidence
- 0.60-0.84: answer is supported by context but required some synthesis across multiple excerpts
- 0.30-0.59: partial or tangentially related context — answer addresses what it can with citations and acknowledges gaps
- 0.10-0.29: very thin context — answer draws on the few available facts with citations, most of the question is acknowledged as not covered
- 0.00: tool results contain literally NO excerpts at all — return empty answer`;

const ANSWER_USER_PROMPT = [
  'QUESTION FROM THE RFP: {{QUESTION}}',
  '',
  'TOOL RESULTS (this is your ONLY source of company information):',
  '"""',
  '{{CONTEXT}}',
  '"""',
  '',
  'DECISION PROCESS — follow these steps in order:',
  '',
  'Step 1: Check if the tool results contain ANY company-specific information.',
  '- "No knowledge base content found" AND "No past performance projects found" AND no excerpts at all = return: {"answer": "", "confidence": 0.0, "found": false}',
  '- If there ARE excerpts but they seem only partially relevant, proceed to Step 2 — a partial answer is always better than a blank page in a proposal.',
  '',
  'Step 2: EVIDENCE INVENTORY — before writing anything, list every citable fact from the tool results that is relevant to this question. For each fact, note its source tag (e.g., KB-1, PP-2, CL-1, ORG).',
  'Examples:',
  '- "KB-2: Completed VA cloud migration, 12 apps, AWS GovCloud"',
  '- "PP-1: $2.3M contract, DoVA, 2023-2024"',
  '- "ORG: CMMI Level 3 certified"',
  'Do NOT add any facts from your own knowledge — only what is written in the tool results.',
  'Do NOT calculate, multiply, add, or derive any new numbers.',
  'If this inventory is completely empty AND the tool results contain no excerpts at all, return: {"answer": "", "confidence": 0.0, "found": false}',
  'If the inventory has even one or two tangentially relevant facts, proceed to Step 3 — write a partial answer citing those facts and acknowledge the gaps.',
  '',
  'Step 3: Write the answer using ONLY facts from your Step 2 inventory.',
  '- Write as "we" / "our team" — this is our company\'s official response',
  '- Every factual sentence MUST include an inline citation [KB-N], [PP-N], [CL-N], or [ORG] referencing the tool result excerpt',
  '- If you find yourself writing a sentence that does not map to an inventory item, delete it immediately',
  '- If the tool results only PARTIALLY answer the question, answer ONLY the parts you have evidence for. Explicitly state which parts you cannot address: "Our available records do not include [specific gap]."',
  '- Do not generalize from a single example. One project does not mean "significant experience" or "extensive track record". Only claim the scope the evidence supports',
  '- Describe what was DONE (past tense), not general capabilities (present tense). "We implemented X on project Y" not "We implement X"',
  '- If the question asks about capability X but the tool results only show capability Y, describe Y with citations and explicitly note the gap: "Our documented experience covers Y [citation]. Our records do not include specific experience with X." Do NOT claim Y is evidence of X, but DO provide the related context.',
  '- Keep the answer under 250 words. Brevity with evidence beats length without it.',
  '',
  'BANNED PHRASES — do NOT use any of these (they signal generic filler, not evidence):',
  '"best practices", "industry standard", "industry-standard", "industry best", "cutting-edge", "state-of-the-art", "world-class", "best-in-class", "typically", "generally", "we believe", "we think", "significant experience", "proven track record", "extensive experience", "demonstrated ability", "proven experience", "expertise in", "proficient with", "comprehensive approach", "robust methodology"',
  'Instead of "industry standard", say what the specific standard IS (e.g., "NIST 800-88" or "NAID AAA").',
  '',
  'REMINDER: Only return an empty answer if the tool results contain literally NO excerpts at all. If there are ANY excerpts — even if only tangentially related — write a partial answer citing what you can and acknowledging gaps. A partial answer always beats a blank page in a proposal.',
  '',
  'Return ONLY valid JSON: {"answer": "<answer text with inline citations>", "confidence": <0.0-1.0>, "found": <true|false>}',
].join('\n');

const generateAnswer = async (
  query: string,
  context: string,
  modelId: string,
): Promise<string> => {
  const userPrompt = ANSWER_USER_PROMPT
    .replace('{{QUESTION}}', query)
    .replace('{{CONTEXT}}', context);

  const response = await getBedrock().send(
    new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(
        JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1024,
          messages: [{ role: 'user', content: userPrompt }],
          system: ANSWER_SYSTEM_PROMPT,
        }),
      ),
    }),
  );

  const result = JSON.parse(new TextDecoder().decode(response.body));
  const rawText = result.content?.[0]?.text ?? '';

  // The new prompt returns JSON: {"answer": "...", "confidence": ..., "found": ...}
  // Some models (especially Sonnet 4) output reasoning text before the JSON.
  // Strategy: try full text as JSON, then find JSON object in the text.
  const extractJson = (text: string): { answer: string; found?: boolean } | null => {
    // Try direct parse (strip code fences first)
    const cleaned = text.replace(/^```(?:json)?\s*/s, '').replace(/\s*```\s*$/s, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch { /* not pure JSON */ }

    // Find last JSON object in text (models often put reasoning before JSON)
    const jsonMatches = text.match(/\{[^{}]*"answer"\s*:\s*"[^"]*"[^{}]*\}/g);
    if (jsonMatches?.length) {
      try {
        return JSON.parse(jsonMatches[jsonMatches.length - 1]);
      } catch { /* malformed */ }
    }

    // Try to find JSON with escaped quotes or multiline answer
    const braceStart = text.lastIndexOf('{"answer"');
    if (braceStart >= 0) {
      // Find the matching closing brace
      let depth = 0;
      for (let i = braceStart; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(text.slice(braceStart, i + 1));
            } catch { break; }
          }
        }
      }
    }

    return null;
  };

  const parsed = extractJson(rawText);
  if (parsed) {
    return parsed.answer ?? '';
  }

  // Last resort: return raw text (will likely fail faithfulness but preserves data)
  return rawText;
};

// ─── promptfoo entry point ──────────────────────────────────────────────────

class GenerationProvider {
  private modelId: string;

  constructor(options?: { config?: { modelId?: string } }) {
    this.modelId = options?.config?.modelId ?? 'anthropic.claude-3-haiku-20240307-v1:0';
  }

  id = () => `rag-generation-${this.modelId}`;

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

      const answer = await generateAnswer(query, combinedContext, this.modelId);

      // When the model correctly refuses (empty answer), use a placeholder that
      // the faithfulness grader can evaluate. An empty answer is vacuously faithful
      // (no claims made = no hallucinations), so the placeholder conveys this.
      const displayAnswer = answer.trim()
        || 'The provided context does not contain sufficient information to answer this question.';

      return {
        output: `${displayAnswer}\n\n---CONTEXT_SEPARATOR---\n\n${combinedContext}`,
      };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  };
}

export default GenerationProvider;
