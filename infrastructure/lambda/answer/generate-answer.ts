import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { invokeModel } from '../helpers/bedrock-http-client';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { getEmbedding, semanticSearchChunks, semanticSearchContentLibrary } from '../helpers/embeddings';
import { PineconeHit } from '../helpers/pinecone';

import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { AnswerQuestionRequestBody, AnswerSource, ContentLibraryItem, QAItem, QuestionItem } from '@auto-rfp/shared';
import { getQuestionItemById } from '../helpers/question';
import { saveAnswer } from './save-answer';
import { DBItem, getItem } from '../helpers/db';
import { safeParseJsonFromModel } from '../helpers/json';
import { loadTextFromS3 } from '../helpers/s3';
import { getDocumentItemByDocumentId } from '../helpers/document';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

export type QuestionItemDynamo = QuestionItem & DBItem

export interface GenerateAnswerParams {
  questionId: string;
  projectId: string;
  orgId: string;
  questionText?: string; // Optional: if provided, skip DB lookup
  topK?: number;
}

export interface GenerateAnswerResult {
  questionId: string;
  answer: string;
  confidence?: number;
  found: boolean;
  sources: AnswerSource[];
  fromContentLibrary: boolean;
}

async function buildContextFromChunkHits(hits: PineconeHit[]) {
  const byChunkKey = new Map<string, PineconeHit>();

  for (const hit of hits) {
    const k = hit.source?.chunkKey;
    if (!k) continue;
    if (!byChunkKey.has(k)) byChunkKey.set(k, hit);
  }

  const uniqueHits = [...byChunkKey.values()];

  return Promise.all(
    uniqueHits.map(async (hit) => {
      const chunkKey = hit.source?.chunkKey;
      const docId = hit.source?.documentId;
      const text = chunkKey ? await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey) : '';
      const { name: fileName } = docId ? await getDocumentItemByDocumentId(docId) || {} : {};
      return { ...hit, text, fileName };
    }),
  );
}

export async function answerWithBedrockLLM(question: string, context: string): Promise<Partial<QAItem>> {
  const systemPrompt = `
You are an expert proposal writer answering U.S. government RFP/SAM.gov solicitation questions.

CRITICAL: Return ONLY valid JSON. Do NOT include any extra text, explanations, or fields inside the "answer" value.

You may answer using:
1) The provided context chunks (preferred), AND
2) Common professional knowledge about proposal writing and typical government procurement practices (allowed only when context is missing).

Rules:
- Always return an answer (never leave it blank).
- If the answer is supported by the provided context, set "found" to true and set "source" to the single best chunkKey.
- If the context does NOT contain the needed information, you MUST:
  - set "found" to false
  - set "source" to ""
  - write an answer that is clearly framed as a GENERAL recommendation / template response (not a claim about this specific RFP).
- Never invent RFP-specific facts (deadlines, page limits, required forms, evaluation weights, email addresses, CLIN pricing, security requirements, etc.) unless explicitly present in the context.
- Do not write disclaimers like "based on the context" or "I don’t have enough information". Instead:
  - If found=true: answer directly.
  - If found=false: give a best-practice answer + what to verify in the solicitation.
- The "answer" field must contain ONLY the answer text
- Do NOT put "Found =", "Source =", or any metadata inside the answer

Output:
Return ONLY valid JSON with exactly these keys (no extra keys, no markdown):

{
  "answer": "string",
  "confidence": 0.0,
  "found": true,
  "source": "chunkKey string",
  "notes": "string"
}

Confidence guidance:
- If grounded=true:
  - 0.85-1.0: explicitly stated in one chunk
  - 0.60-0.84: supported but lightly synthesized within one chunk
- If grounded=false:
  - 0.30-0.59: good general guidance/template
  - 0.00-0.29: question is too RFP-specific to answer; provide a minimal safe template and list exactly what must be verified

Citations:
- When grounded=true, choose ONE best chunkKey for "source".
- When grounded=false, "source" must be "".
`.trim();

  const userPrompt = [
    'Context:',
    '"""',
    context,
    '"""',
    '',
    `Question: ${question}`,
  ].join('\n');

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
  };

  const responseBody = await invokeModel(
    BEDROCK_MODEL_ID,
    JSON.stringify(payload),
    'application/json',
    'application/json'
  );

  const raw = new TextDecoder('utf-8').decode(responseBody);
  console.log('Raw: ', raw);
  let outer: any;
  try {
    outer = JSON.parse(raw);
  } catch {
    console.error('Bad response JSON from Bedrock:', raw);
    throw new Error('Invalid JSON envelope from Bedrock');
  }
  const assistantText = outer?.content?.[0]?.text;
  if (!assistantText) {
    throw new Error('Model returned no text content');
  }
  return safeParseJsonFromModel(assistantText);
}

function buildAnswerSources(texts: Awaited<ReturnType<typeof buildContextFromChunkHits>>): AnswerSource[] {
  return texts.map(hit => ({
    id: hit.id || uuidv4(),
    documentId: hit.source?.documentId,
    fileName: hit.fileName,
    chunkKey: hit.source?.chunkKey,
    textContent: hit.text,
  }));
}

/**
 * Core answer generation logic - can be called from API or Step Function
 */
export async function generateAnswerForQuestion(params: GenerateAnswerParams): Promise<GenerateAnswerResult> {
  const { questionId, projectId, orgId, questionText, topK = 30 } = params;

  // Get question text - either from params or from DB
  const question = questionText
    ? questionText.trim()
    : (await getQuestionItemById(projectId, questionId)).question;

  if (!question) {
    throw new Error('No question text available');
  }

  const questionEmbedding = await getEmbedding(question);

  // Check content library first 
  const contentLibraryHits = await semanticSearchContentLibrary(orgId, questionEmbedding, 1);

  if (contentLibraryHits.length && (contentLibraryHits[0]?.score || 0) > 0.9) {
    const topHit = contentLibraryHits[0];
    const key = {
      [PK_NAME]: topHit?.source?.[PK_NAME],
      [SK_NAME]: topHit?.source?.[SK_NAME],
    };

    const dbItem = await getItem<ContentLibraryItem & DBItem>(key[PK_NAME]!, key[SK_NAME]!);

    if (dbItem) {
      await saveAnswer({
        questionId,
        projectId,
        text: dbItem.answer,
        confidence: topHit?.score,
        sources: [],
      });

      return {
        questionId,
        answer: dbItem.answer,
        confidence: topHit?.score,
        found: true,
        sources: [],
        fromContentLibrary: true,
      };
    }
  }

  const hits = await semanticSearchChunks(orgId, questionEmbedding, topK);
  console.log('Hits:', JSON.stringify(hits));

  if (!hits.length) {
    throw new Error('No matching chunks found for this question');
  }

  const texts = await buildContextFromChunkHits(hits);

  const finalContext = texts
    .map(h => `CHUNK_KEY: ${h.source?.chunkKey}\nTEXT:\n${h.text}\n---`)
    .join('\n');

  const { answer, confidence, found } = await answerWithBedrockLLM(question, finalContext);

  const sources = buildAnswerSources(texts);

  await saveAnswer({
    questionId,
    projectId,
    text: answer,
    confidence,
    sources,
  });

  return {
    questionId,
    answer: answer || '',
    confidence,
    found: found ?? false,
    sources,
    fromContentLibrary: false,
  };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('answer-question event:', JSON.stringify(event));

  const body: AnswerQuestionRequestBody = JSON.parse(event.body || '');

  const topK = body.topK && body.topK > 0 ? body.topK : 30;

  const { questionId, projectId, question: requestQuestion, orgId } = body;

  if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

  if (!questionId && !requestQuestion?.trim()) {
    return apiResponse(400, { message: 'Either questionId (preferred) or question text must be provided' });
  }

  try {
    const result = await generateAnswerForQuestion({
      questionId: questionId || '',
      projectId,
      orgId,
      questionText: requestQuestion,
      topK,
    });

    return apiResponse(200, {
      sources: result.sources,
      questionId: result.questionId,
      answer: result.answer,
      confidence: result.confidence,
      found: result.found,
      topK,
    });
  } catch (err) {
    console.error('Error in answer-question handler:', err);
    
    if (err instanceof Error && err.message === 'No matching chunks found for this question') {
      return apiResponse(404, { message: err.message });
    }

    return apiResponse(500, {
      message: 'Failed to answer question',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:generate'))
    .use(httpErrorMiddleware())
);