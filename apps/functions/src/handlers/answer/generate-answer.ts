import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

import { invokeModel } from '@/helpers/bedrock-http-client';
import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { getEmbedding } from '@/helpers/embeddings';
import { semanticSearchContentLibrary } from '@/helpers/semantic-search';

import { withSentryLambda, Sentry } from '@/sentry-lambda';
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
import {
  AnswerQuestionRequestBodySchema,
  AnswerSource,
  ConfidenceBreakdown,
  ContentLibraryItem,
  QAItem,
} from '@auto-rfp/core';
import { getQuestionItemById, QuestionItemDynamo } from '@/helpers/question';
import { saveAnswer } from './save-answer';
import { DBItem, getItem } from '@/helpers/db';
import { safeParseJsonFromModel } from '@/helpers/json';
import { calculateConfidenceScore, ConfidenceScoreResult } from '@/helpers/confidence-score';
import { trackContentLibraryUsage } from '@/helpers/usage-tracking';
import { getAnswerSystemPrompt } from '@/constants/prompt';
import { ANSWER_TOOLS, executeAnswerTool } from '@/helpers/answer-tools';

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

export interface GenerateAnswerParams {
  questionId: string;
  projectId: string;
  orgId: string;
  opportunityId?: string;
  questionFileId?: string;
  questionText?: string;
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

// ─── Content Library Check ────────────────────────────────────────────────────

// Minimum cosine similarity score to even consider a content library match.
// Below this threshold, the question is too different to be a direct match.
const CL_MIN_SIMILARITY_THRESHOLD = 0.82;

/**
 * Check if the content library has a direct answer for the question.
 * Returns the matched item and its score, or null if no match.
 *
 * Uses a two-stage filter:
 * 1. Semantic similarity threshold (>= 0.82) to eliminate weak matches
 * 2. LLM evaluation to confirm the match is a genuine direct answer
 */
const checkContentLibrary = async (
  orgId: string,
  question: string,
  questionEmbedding: number[],
): Promise<{ item: ContentLibraryItem & DBItem; score: number } | null> => {
  const hits = await semanticSearchContentLibrary(orgId, questionEmbedding, 5);
  if (!hits.length) return null;

  // Stage 1: Filter by minimum similarity threshold
  const strongHits = hits.filter((h) => (h.score ?? 0) >= CL_MIN_SIMILARITY_THRESHOLD);
  if (!strongHits.length) {
    console.log(`[CL-Check] No hits above threshold ${CL_MIN_SIMILARITY_THRESHOLD} (best: ${(hits[0]?.score ?? 0).toFixed(3)})`);
    return null;
  }

  // Load matched items from DynamoDB
  const clItems: Array<{ item: ContentLibraryItem & DBItem; score: number }> = [];
  for (const hit of strongHits) {
    const pk = hit?.source?.[PK_NAME];
    const sk = hit?.source?.[SK_NAME];
    if (!pk || !sk) continue;
    const item = await getItem<ContentLibraryItem & DBItem>(pk, sk);
    if (item) clItems.push({ item, score: hit.score ?? 0 });
  }

  if (!clItems.length) return null;

  // Stage 2: Ask LLM to confirm the match is a genuine direct answer
  const clContext = clItems.map(({ item }, i) =>
    `[CL_ITEM_${i}]\nQuestion: ${item.question}\nAnswer: ${item.answer}\n---`
  ).join('\n');

  const evalPayload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 256,
    temperature: 0,
    system: `You are a strict evaluator deciding if a pre-existing Q&A pair can be used as-is to answer a new question.

MATCH CRITERIA (ALL must be true):
- The content library question asks essentially the SAME thing as the new question (not just related topic)
- The content library answer DIRECTLY and COMPLETELY answers the new question
- The answer would NOT be misleading or incomplete if submitted as the response

Return ONLY valid JSON:
- If a Q&A pair is a direct, complete answer: {"match": true, "index": <number>}
- If no Q&A pair fully answers the question: {"match": false, "index": -1}

When in doubt, return {"match": false, "index": -1}. It is better to generate a fresh answer than to reuse a wrong one.`,
    messages: [{ role: 'user', content: [{ type: 'text', text: `New Question: ${question}\n\nContent Library Q&A Pairs:\n${clContext}` }] }],
  };

  try {
    const response = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(evalPayload));
    const raw = new TextDecoder('utf-8').decode(response);
    const outer = JSON.parse(raw);
    const text = outer?.content?.[0]?.text || '';
    const eval_ = safeParseJsonFromModel(text) as { match?: boolean; index?: number };

    if (eval_.match && typeof eval_.index === 'number' && eval_.index >= 0 && eval_.index < clItems.length) {
      const matched = clItems[eval_.index]!;
      console.log(`[CL-Check] ✅ LLM confirmed match at index ${eval_.index} (score: ${matched.score.toFixed(3)})`);
      return matched;
    }

    console.log(`[CL-Check] LLM rejected all ${clItems.length} candidates`);
  } catch (err) {
    console.warn('[CL-Check] Evaluation failed, falling through to tool-based generation:', (err as Error)?.message);
  }

  return null;
};

// ─── Tool-based Answer Generation ────────────────────────────────────────────

/**
 * Generate an answer using Claude with tools.
 * Claude can search the KB, past performance, content library, and org context
 * to find the information needed to answer the question accurately.
 */
const generateAnswerWithTools = async (
  question: string,
  orgId: string,
  questionId: string,
  systemPrompt: string,
  projectId?: string,
  opportunityId?: string,
): Promise<{ answer: string; found: boolean; toolsUsed: string[] }> => {
  const MAX_TOOL_ROUNDS = 3;
  const toolsUsed: string[] = [];

  const userPrompt = `You are writing a winning RFP response on behalf of our company. The evaluator will score this answer to decide whether to award us the contract. Quality and specificity are critical.

QUESTION FROM THE RFP: ${question}

RESEARCH STRATEGY — use tools to gather the strongest possible evidence:
1. search_knowledge_base — find our company capabilities, processes, and technical expertise relevant to this question
2. search_past_performance — find specific contract examples, metrics, and results that demonstrate our track record (critical for scoring)
3. get_organization_context — get our certifications, clearances, team size, and company details to cite in the answer
4. get_content_library — find pre-approved language for compliance, certifications, or standard responses
5. get_solicitation_text — check the RFP for specific requirements, evaluation criteria, or context that this question references

WRITING INSTRUCTIONS:
- Write as "we" / "our team" — this is our company's official response to the evaluator
- Lead with our strongest capability or most relevant experience
- Include specific evidence: project names, contract values, team sizes, SLA metrics, years of experience
- Address every part of the question — missing sub-questions loses evaluation points
- Be confident and direct — avoid hedging language like "we believe" or "we think"
- Keep the answer 150-400 words depending on complexity

Return ONLY valid JSON: {"answer": "<complete submission-ready answer>", "confidence": <0.0-1.0>, "found": <true|false>}
- found: true if you found relevant company-specific information to support the answer
- found: false if you had to rely on general best practices (still provide a professional answer)`;

  const messages: Array<{ role: string; content: unknown }> = [
    { role: 'user', content: [{ type: 'text', text: userPrompt }] },
  ];

  let rawText = '';
  let toolRounds = 0;

  while (toolRounds <= MAX_TOOL_ROUNDS) {
    const isLastRound = toolRounds >= MAX_TOOL_ROUNDS;

    // Always include tools when the conversation contains tool_use/tool_result blocks,
    // otherwise the Anthropic API rejects the request with:
    // "Requests which include tool_use or tool_result blocks must define tools."
    const hasToolBlocks = toolRounds > 0;

    const requestBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      system: systemPrompt,
      messages,
      max_tokens: 4096,
      temperature: 0.2,
      // Include tools on every round that has tool history, or when we still allow tool use
      ...((hasToolBlocks || !isLastRound) ? { tools: ANSWER_TOOLS } : {}),
    };

    // NOTE: The "stop using tools" instruction is now appended to the tool_result
    // user message in the previous iteration to avoid consecutive user roles.

    // Wrap each LLM round in a Sentry span
    const responseBody = await Sentry.startSpan(
      { name: `llm-round-${toolRounds}`, op: 'ai.completion' },
      () => invokeModel(BEDROCK_MODEL_ID, JSON.stringify(requestBody)),
    );
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as {
      stop_reason?: string;
      content?: Array<{ type: string; id?: string; name?: string; input?: unknown; text?: string }>;
    };

    const stopReason = parsed.stop_reason ?? 'end_turn';
    const content = parsed.content ?? [];

    if (stopReason === 'tool_use' && !isLastRound) {
      const toolUseBlocks = content.filter(c => c.type === 'tool_use');
      console.log(`[answer-tools] Round ${toolRounds + 1}: ${toolUseBlocks.length} tool call(s)`);

      messages.push({ role: 'assistant', content });

      // Wrap tool execution in Sentry span
      const toolResults = await Sentry.startSpan(
        { name: `tool-execution-round-${toolRounds + 1}`, op: 'ai.tool' },
        () => Promise.all(
          toolUseBlocks.map(block => {
            toolsUsed.push(block.name ?? '');
            return executeAnswerTool({
              toolName: block.name ?? '',
              toolInput: (block.input ?? {}) as Record<string, unknown>,
              toolUseId: block.id ?? '',
              orgId,
              questionId,
              projectId,
              opportunityId,
            });
          }),
        ),
      );

      const toolResultContent: Array<unknown> = toolResults.map(r => ({
        type: 'tool_result',
        tool_use_id: r.tool_use_id,
        content: r.content,
      }));

      // If the next iteration will be the last round, append a "stop using tools"
      // instruction to the same user message to avoid consecutive user roles.
      if (toolRounds + 1 >= MAX_TOOL_ROUNDS) {
        toolResultContent.push({
          type: 'text',
          text: 'You have gathered enough information. Do NOT use any more tools. Provide your final answer now as JSON: {"answer": "<answer>", "confidence": <0.0-1.0>, "found": <true|false>}',
        });
      }

      messages.push({
        role: 'user',
        content: toolResultContent,
      });

      toolRounds++;
      continue;
    }

    // Extract text response
    rawText = content
      .filter(c => c.type === 'text')
      .map(c => c.text ?? '')
      .join('\n')
      .trim();

    // If last round still returned tool_use, force final answer
    if (!rawText && stopReason === 'tool_use' && isLastRound) {
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Now provide the final answer based on all information gathered. Return ONLY valid JSON: {"answer": "<answer>", "confidence": <0.0-1.0>, "found": <true|false>}' }],
      });
      const finalResponse = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        system: systemPrompt,
        messages,
        max_tokens: 4096,
        temperature: 0.2,
        // Must include tools when conversation has tool_use/tool_result blocks
        tools: ANSWER_TOOLS,
      }));
      const finalParsed = JSON.parse(new TextDecoder('utf-8').decode(finalResponse)) as { content?: Array<{ type: string; text?: string }> };
      rawText = (finalParsed.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('\n').trim();
    }

    console.log(`[answer-tools] Complete after ${toolRounds} tool round(s), tools used: [${toolsUsed.join(', ')}]`);
    break;
  }

  if (!rawText.trim()) {
    return { answer: '', found: false, toolsUsed };
  }

  try {
    const parsed = safeParseJsonFromModel(rawText) as Partial<QAItem> & { found?: boolean };
    // Defensive: ensure answer is always a string
    const answerValue = parsed.answer;
    const answerStr = typeof answerValue === 'string' ? answerValue : String(answerValue ?? '');
    return {
      answer: answerStr || '',
      found: parsed.found ?? !!(answerStr?.trim()),
      toolsUsed,
    };
  } catch {
    // Model returned plain text instead of JSON — use it as the answer
    return { answer: rawText, found: true, toolsUsed };
  }
};

// ─── Core answer generation ───────────────────────────────────────────────────

/**
 * Core answer generation logic.
 *
 * Flow:
 * 1. Check content library for a direct match → return immediately if found
 * 2. Use AI with tools to generate answer from KB, past performance, org context
 */
export const generateAnswerForQuestion = async (
  params: GenerateAnswerParams,
): Promise<GenerateAnswerResult> => {
  const { questionId, projectId, orgId, opportunityId, questionText, questionFileId } = params;

  // Get question text — use opportunityId + fileId for new SK pattern
  // Coerce to string defensively — callers (e.g. Step Functions) may pass non-string values
  const question = questionText
    ? String(questionText).trim()
    : String((await getQuestionItemById(projectId, opportunityId ?? '', questionFileId ?? '', questionId)).question ?? '').trim();

  if (!question) {
    throw new Error('No question text available');
  }

  // Wrap embedding call in Sentry span for observability
  const questionEmbedding = await Sentry.startSpan(
    { name: 'question-embedding', op: 'ai.embeddings' },
    () => getEmbedding(question),
  );

  // ── Step 1: Content library check ──────────────────────────────────────────
  console.log(`[answer] Checking content library for: "${question.substring(0, 80)}..."`);
  // Wrap content library check in Sentry span (includes semantic search + LLM eval)
  const clMatch = await Sentry.startSpan(
    { name: 'content-library-check', op: 'ai.pipeline' },
    () => checkContentLibrary(orgId, question, questionEmbedding).catch(err => {
      console.warn('[answer] Content library check failed, falling through:', (err as Error)?.message);
      return null;
    }),
  );

  if (clMatch) {
    console.log(`[answer] ✅ Content library match found (score: ${clMatch.score.toFixed(3)})`);

    const confidence = calculateConfidenceScore({
      llmConfidence: clMatch.score,
      found: true,
      questionText: question,
      answerText: clMatch.item.answer,
      sources: [],
      fromContentLibrary: true,
      similarityScores: [clMatch.score],
      sourceCreatedDates: clMatch.item.updatedAt ? [clMatch.item.updatedAt] : undefined,
    });

    await saveAnswer({
      questionId,
      projectId,
      opportunityId,
      questionFileId,
      text: clMatch.item.answer,
      confidence: confidence.overall / 100,
      confidenceBreakdown: confidence.breakdown,
      confidenceBand: confidence.band,
      sources: [],
    });

    // Track content library usage (non-blocking)
    trackContentLibraryUsage(orgId, clMatch.item.id, projectId).catch(() => {});

    return {
      questionId,
      answer: clMatch.item.answer,
      confidence: confidence.overall / 100,
      confidenceBreakdown: confidence.breakdown,
      confidenceBand: confidence.band,
      found: true,
      sources: [],
      fromContentLibrary: true,
    };
  }

  // ── Step 2: Tool-based AI generation ───────────────────────────────────────
  console.log(`[answer] No CL match — using tool-based generation for: "${question.substring(0, 80)}..."`);

  const systemPrompt = await getAnswerSystemPrompt(orgId);

  // Wrap tool-based generation in Sentry span (includes all LLM rounds and tool calls)
  const { answer, found, toolsUsed } = await Sentry.startSpan(
    { name: 'tool-based-generation', op: 'ai.pipeline' },
    () => generateAnswerWithTools(
      question,
      orgId,
      questionId,
      systemPrompt,
      projectId,
      opportunityId,
    ),
  );

  console.log(`[answer] Tool-based generation complete. found=${found}, tools=[${toolsUsed.join(', ')}]`);

  const confidence = calculateConfidenceScore({
    llmConfidence: found ? 0.7 : 0.3,
    found,
    questionText: question,
    answerText: answer,
    sources: [],
    fromContentLibrary: false,
    similarityScores: [],
  });

  await saveAnswer({
    questionId,
    projectId,
    opportunityId,
    questionFileId,
    text: answer,
    confidence: confidence.overall / 100,
    confidenceBreakdown: confidence.breakdown,
    confidenceBand: confidence.band,
    sources: [],
  });

  return {
    questionId,
    answer,
    confidence: confidence.overall / 100,
    confidenceBreakdown: confidence.breakdown,
    confidenceBand: confidence.band,
    found,
    sources: [],
    fromContentLibrary: false,
  };
};

// ─── HTTP Handler ─────────────────────────────────────────────────────────────

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  console.log('answer-question event:', JSON.stringify(event));

  const raw = JSON.parse(event.body || '{}');
  const { success, data, error } = AnswerQuestionRequestBodySchema.safeParse(raw);

  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const topK = data.topK && data.topK > 0 ? data.topK : 30;
  const { questionId, projectId, opportunityId, questionFileId, question: requestQuestion, orgId } = data;

  if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

  try {
    const result = await generateAnswerForQuestion({
      questionId: questionId || '',
      projectId,
      orgId,
      opportunityId,
      questionFileId,
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
      fromContentLibrary: result.fromContentLibrary,
      topK,
    });
  } catch (err) {
    console.error('Error in answer-question handler:', err);

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
