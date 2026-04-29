import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { searchSolicitation, SolicitationSearchHit } from '@/helpers/pinecone';
import { saveChatMessagePair } from '@/helpers/opportunity-assistant';
import { getOpportunity } from '@/helpers/opportunity';
import { loadTextFromS3 } from '@/helpers/s3';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import {
  OpportunityAssistantChatRequestSchema,
  OpportunityAssistantChatResponseSchema,
  ChatSourceCitation,
} from '@auto-rfp/core';

const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

/** Maximum characters of context to include in the prompt (to stay within model token limits) */
const MAX_CONTEXT_CHARS = 15000;
/** Maximum characters for source excerpt displayed to user */
const EXCERPT_MAX_CHARS = 500;

const QueryParamsSchema = z.object({
  opportunityId: z.string().min(1, 'opportunityId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  orgId: z.string().min(1, 'orgId is required'),
});

interface AuthedEvent extends APIGatewayProxyEventV2 {
  auth?: {
    userId?: string;
    userName?: string;
  };
}

const buildPrompt = (question: string, contexts: Array<{ fileName: string; text: string; index: number }>) => {
  const contextText = contexts
    .map((c, i) => `[Source ${i + 1}: ${c.fileName}]\n${c.text}`)
    .join('\n\n---\n\n');

  return `You are an AI assistant helping users understand government solicitation documents (RFPs, RFIs, RFQs).

Based on the following excerpts from the solicitation documents, answer the user's question.
If the answer cannot be found in the provided context, say so clearly.
Always cite which source(s) your answer comes from using [Source N] notation.

CONTEXT:
${contextText}

USER QUESTION:
${question}

Provide a clear, concise answer with source citations.`;
};

const invokeClaudeChat = async (prompt: string): Promise<string> => {
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  };

  const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(requestBody));
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as {
    content?: Array<{ type: string; text?: string }>;
  };

  const textContent = parsed.content?.find(c => c.type === 'text');
  return textContent?.text ?? '';
};

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  // Parse query params
  const { success: querySuccess, data: queryData, error: queryError } = QueryParamsSchema.safeParse(
    event.queryStringParameters,
  );
  if (!querySuccess) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: queryError.issues });
  }
  const { opportunityId: oppId, projectId, orgId } = queryData;

  // Parse body
  const { success, data, error } = OpportunityAssistantChatRequestSchema.safeParse(
    JSON.parse(event.body || '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  // Verify opportunity exists and user has access
  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) {
    return apiResponse(404, { message: 'Opportunity not found' });
  }

  // Search solicitation documents
  const hits = await searchSolicitation(oppId, data.message, 5);

  if (hits.length === 0) {
    // No indexed documents — return helpful message
    const { assistantMsg } = await saveChatMessagePair({
      opportunityId: oppId,
      userMessage: data.message,
      assistantAnswer: 'I don\'t have any solicitation documents indexed for this opportunity yet. Please upload solicitation documents first.',
      sources: [],
      userId: event.auth?.userId,
    });

    return apiResponse(200, {
      answer: 'I don\'t have any solicitation documents indexed for this opportunity yet. Please upload solicitation documents first.',
      sources: [],
      messageId: assistantMsg.messageId,
    });
  }

  // Load chunk text from S3
  const contexts: Array<{ fileName: string; text: string; index: number; hit: SolicitationSearchHit }> = [];
  let totalChars = 0;
  let failedChunkCount = 0;

  for (const hit of hits) {
    if (totalChars >= MAX_CONTEXT_CHARS) break;

    try {
      const text = await loadTextFromS3(hit.metadata.bucket || DOCUMENTS_BUCKET, hit.metadata.chunkKey);
      const truncatedText = text.slice(0, MAX_CONTEXT_CHARS - totalChars);

      contexts.push({
        fileName: hit.metadata.fileName,
        text: truncatedText,
        index: hit.metadata.chunkIndex,
        hit,
      });
      totalChars += truncatedText.length;
    } catch (err) {
      failedChunkCount++;
      console.warn(`Failed to load chunk ${hit.metadata.chunkKey}:`, err);
    }
  }

  // Fail if all chunks failed to load
  if (failedChunkCount === hits.length) {
    return apiResponse(500, { message: 'Failed to load document context' });
  }

  // Build prompt and call Claude
  const prompt = buildPrompt(data.message, contexts);
  const answer = await invokeClaudeChat(prompt);

  // Parse which sources were actually cited in the answer
  // Look for [Source N] patterns in the answer
  const citedSourceIndices = new Set<number>();
  const sourcePattern = /\[Source\s*(\d+)\]/gi;
  let match;
  while ((match = sourcePattern.exec(answer)) !== null) {
    const sourceNum = parseInt(match[1], 10);
    // Source numbers are 1-indexed in the prompt, convert to 0-indexed
    if (sourceNum >= 1 && sourceNum <= contexts.length) {
      citedSourceIndices.add(sourceNum - 1);
    }
  }

  // Only include sources that were actually cited in the answer
  // If no sources were cited (e.g., "I can't answer this"), return empty sources
  const sources: ChatSourceCitation[] = contexts
    .filter((_, i) => citedSourceIndices.has(i))
    .map((ctx, i) => ({
      sourceId: `src-${i}`,
      questionFileId: ctx.hit.metadata.questionFileId,
      fileName: ctx.fileName,
      chunkIndex: ctx.index,
      excerpt: ctx.text.slice(0, EXCERPT_MAX_CHARS) + (ctx.text.length > EXCERPT_MAX_CHARS ? '...' : ''),
      // Clamp relevance to 0-1 range (Pinecone scores can vary)
      relevance: Math.max(0, Math.min(1, ctx.hit.score ?? 0)),
    }));

  // Save chat messages
  const { assistantMsg } = await saveChatMessagePair({
    opportunityId: oppId,
    userMessage: data.message,
    assistantAnswer: answer,
    sources,
    userId: event.auth?.userId,
  });

  // Non-blocking audit log for AI chat interaction
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId: event.auth?.userId ?? 'system',
      userName: event.auth?.userName ?? 'system',
      organizationId: orgId,
      action: 'OPPORTUNITY_ASSISTANT_MESSAGE_SENT',
      resource: 'opportunity_assistant_chat',
      resourceId: assistantMsg.messageId,
      changes: {
        after: {
          opportunityId: oppId,
          sourcesCount: sources.length,
          answerLength: answer.length,
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch(err => console.warn('Failed to write audit log (non-blocking):', err));

  const response = OpportunityAssistantChatResponseSchema.parse({
    answer,
    sources,
    messageId: assistantMsg.messageId,
  });

  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
