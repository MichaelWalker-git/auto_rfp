import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { invokeModel } from '@/helpers/bedrock-http-client';

import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { getEmbedding, semanticSearchChunks, semanticSearchContentLibrary } from '@/helpers/embeddings';
import { PineconeHit } from '@/helpers/pinecone';

import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';
import { requireEnv } from '@/helpers/env';
import { AnswerQuestionRequestBody, AnswerSource, ConfidenceBreakdown, ContentLibraryItem, QAItem, QuestionItem } from '@auto-rfp/core';
import { getQuestionItemById } from '@/helpers/question';
import { saveAnswer } from './save-answer';
import { DBItem, getItem } from '@/helpers/db';
import { safeParseJsonFromModel } from '@/helpers/json';
import { loadTextFromS3 } from '@/helpers/s3';
import { getDocumentItemByDocumentId } from '@/helpers/document';
import { calculateConfidenceScore, ConfidenceScoreResult } from '@/helpers/confidence-score';
import { trackContentLibraryUsage, trackDocumentUsage } from '@/helpers/usage-tracking';
import { ANSWER_SYSTEM_PROMPT, getAnswerSystemPrompt, useAnswerUserPrompt } from '@/constants/prompt';

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
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: 'high' | 'medium' | 'low';
  found: boolean;
  sources: AnswerSource[];
  fromContentLibrary: boolean;
}

/**
 * Extract documentId from a Pinecone hit's sort_key.
 * SK format: "KB#{kbId}#DOC#{documentId}"
 */
function extractDocumentIdFromSK(sk: string | undefined): string | undefined {
  if (!sk) return undefined;
  const match = sk.match(/#DOC#([^#]+)/);
  return match?.[1];
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
      const text = chunkKey ? await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey) : '';

      // Use PK/SK from Pinecone metadata to look up the document in DynamoDB
      const pk = hit.source?.[PK_NAME];
      const sk = hit.source?.[SK_NAME];
      const docId = hit.source?.documentId ?? extractDocumentIdFromSK(sk);

      let fileName: string | undefined;
      if (pk && sk) {
        // Direct DynamoDB lookup using PK/SK stored in Pinecone metadata
        const docItem = await getItem<any>(pk, sk);
        fileName = docItem?.name;
      } else if (docId) {
        // Fallback: look up by documentId
        const doc = await getDocumentItemByDocumentId(docId);
        fileName = doc?.name;
      }

      return { ...hit, text, fileName, documentId: docId };
    }),
  );
}

export async function answerWithBedrockLLM(question: string, context: string, customSystemPrompt?: string, customUserPrompt?: string): Promise<Partial<QAItem>> {
  const systemPrompt = customSystemPrompt || ANSWER_SYSTEM_PROMPT;

  const userPrompt = customUserPrompt || [
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
    documentId: hit.documentId ?? hit.source?.documentId,
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

  // Step 1: Check content library first — load top 10 similar Q&A pairs and ask LLM to evaluate
  console.log(`[CL-Search] Searching content library for orgId=${orgId}, question="${question.substring(0, 80)}..."`);
  const contentLibraryHits = await semanticSearchContentLibrary(orgId, questionEmbedding, 10);
  console.log(`[CL-Search] Found ${contentLibraryHits.length} content library hits, scores: [${contentLibraryHits.map(h => h.score?.toFixed(3)).join(', ')}]`);

  if (contentLibraryHits.length > 0) {
    // Load all matched CL items from DynamoDB
    const clItems: (ContentLibraryItem & DBItem)[] = [];
    for (const hit of contentLibraryHits) {
      const pk = hit?.source?.[PK_NAME];
      const sk = hit?.source?.[SK_NAME];
      if (!pk || !sk) continue;
      const item = await getItem<ContentLibraryItem & DBItem>(pk, sk);
      if (item) clItems.push(item);
    }

    console.log(`[CL-Search] Loaded ${clItems.length} CL items from DynamoDB (questions: ${clItems.map(i => `"${i.question.substring(0, 50)}..."`).join(', ')})`);

    if (clItems.length > 0) {
      // Build CL context for LLM evaluation
      const clContext = clItems.map((item, i) =>
        `[CL_ITEM_${i}]\nQuestion: ${item.question}\nAnswer: ${item.answer}\n---`
      ).join('\n');

      // Ask LLM if any content library item answers the question
      const clEvalPayload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 512,
        temperature: 0,
        system: `You are evaluating if any pre-existing Q&A pair from a content library answers a given question. If one of the provided Q&A pairs directly answers the question (same topic, relevant answer), respond with ONLY valid JSON: {"match": true, "index": <number>}. If none match, respond: {"match": false, "index": -1}. Return ONLY JSON, no explanation.`,
        messages: [{ role: 'user', content: [{ type: 'text', text: `Question: ${question}\n\nContent Library Q&A Pairs:\n${clContext}` }] }],
      };

      try {
        const clEvalResponse = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(clEvalPayload), 'application/json', 'application/json');
        const clEvalRaw = new TextDecoder('utf-8').decode(clEvalResponse);
        const clEvalOuter = JSON.parse(clEvalRaw);
        const clEvalText = clEvalOuter?.content?.[0]?.text || '';
        const clEval = safeParseJsonFromModel(clEvalText) as { match?: boolean; index?: number };
        console.log(`[CL-Eval] LLM evaluation result: match=${clEval.match}, index=${clEval.index}`);

        if (clEval.match && typeof clEval.index === 'number' && clEval.index >= 0 && clEval.index < clItems.length) {
          const matchedItem = clItems[clEval.index]!;
          console.log(`[CL-Match] ✅ Using CL item #${clEval.index}: "${matchedItem.question.substring(0, 60)}..." (score: ${contentLibraryHits[clEval.index]?.score?.toFixed(3)})`);
          const matchedScore = contentLibraryHits[clEval.index]?.score || 0.8;

          const clConfidence = calculateConfidenceScore({
            llmConfidence: matchedScore,
            found: true,
            questionText: question,
            answerText: matchedItem.answer,
            sources: [],
            fromContentLibrary: true,
            similarityScores: [matchedScore],
            sourceCreatedDates: matchedItem.updatedAt ? [matchedItem.updatedAt] : undefined,
          });

          await saveAnswer({
            questionId,
            projectId,
            text: matchedItem.answer,
            confidence: clConfidence.overall / 100,
            confidenceBreakdown: clConfidence.breakdown,
            confidenceBand: clConfidence.band,
            sources: [],
          });

          // Track content library usage (non-blocking)
          trackContentLibraryUsage(orgId, matchedItem.kbId, matchedItem.id, projectId).catch(() => {});

          return {
            questionId,
            answer: matchedItem.answer,
            confidence: clConfidence.overall / 100,
            confidenceBreakdown: clConfidence.breakdown,
            confidenceBand: clConfidence.band,
            found: true,
            sources: [],
            fromContentLibrary: true,
          };
        }
      } catch (clEvalErr) {
        console.warn('Content library LLM evaluation failed, falling through to KB search:', clEvalErr);
      }
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

  // Fetch org-specific custom prompts (falls back to defaults if none configured)
  const [customSystemPrompt, customUserPrompt] = await Promise.all([
    getAnswerSystemPrompt(orgId),
    useAnswerUserPrompt(orgId, finalContext, question),
  ]);

  const { answer, confidence, found } = await answerWithBedrockLLM(question, finalContext, customSystemPrompt, customUserPrompt);

  const sources = buildAnswerSources(texts);

  // Calculate enhanced multi-factor confidence score
  const similarityScores = hits
    .filter((h) => h.score != null)
    .map((h) => h.score as number);

  const sourceCreatedDates = texts
    .map((t) => (t as any).createdAt as string | undefined)
    .filter(Boolean);

  const enhancedConfidence: ConfidenceScoreResult = calculateConfidenceScore({
    llmConfidence: confidence ?? 0,
    found: found ?? false,
    questionText: question,
    answerText: answer || '',
    sources,
    fromContentLibrary: false,
    similarityScores,
    sourceCreatedDates: sourceCreatedDates.length > 0 ? sourceCreatedDates : undefined,
  });

  await saveAnswer({
    questionId,
    projectId,
    text: answer,
    confidence: enhancedConfidence.overall / 100,
    confidenceBreakdown: enhancedConfidence.breakdown,
    confidenceBand: enhancedConfidence.band,
    sources,
  });

  // Track KB document usage for all source documents (non-blocking)
  const seenDocIds = new Set<string>();
  for (const t of texts) {
    const docId = t.documentId;
    const sk = t.source?.[SK_NAME];
    if (!docId || seenDocIds.has(docId)) continue;
    seenDocIds.add(docId);

    // Extract kbId from SK: "KB#{kbId}#DOC#{docId}"
    const kbMatch = sk?.match(/^KB#([^#]+)/);
    if (kbMatch?.[1]) {
      trackDocumentUsage(kbMatch[1], docId).catch(() => {});
    }
  }

  return {
    questionId,
    answer: answer || '',
    confidence: enhancedConfidence.overall / 100,
    confidenceBreakdown: enhancedConfidence.breakdown,
    confidenceBand: enhancedConfidence.band,
    found: found ?? false,
    sources,
    fromContentLibrary: false,
  };
}

export const baseHandler = async (
  event: AuthedEvent,
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

    
    setAuditContext(event, {
      action: 'ANSWER_GENERATED',
      resource: 'answer',
      resourceId: event.queryStringParameters?.questionId ?? 'unknown',
    });

    return apiResponse(200, {
      sources: result.sources,
      questionId: result.questionId,
      answer: result.answer,
      confidence: result.confidence,
      confidenceBreakdown: result.confidenceBreakdown,
      confidenceBand: result.confidenceBand,
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
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);