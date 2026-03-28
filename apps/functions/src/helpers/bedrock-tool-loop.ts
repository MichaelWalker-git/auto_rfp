/**
 * Reusable tool-use loop for Claude (Bedrock) invocations.
 *
 * Handles the full conversation cycle:
 *   1. Initial request with tools offered
 *   2. Tool execution and result injection
 *   3. Repeat up to maxToolRounds
 *   4. Final text extraction and JSON parsing
 *
 * Used by both generate-document-worker.ts and exec-brief-worker.ts.
 */

import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeJsonParse, type SchemaLike } from '@/helpers/executive-opportunity-brief';
import type { ToolDefinition, ToolResult } from '@/types/tool';

/** Token multiplier for retry when response is truncated due to max_tokens */
const TRUNCATION_RETRY_TOKEN_MULTIPLIER = 2;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvokeClaudeWithToolsArgs<T> {
  modelId: string;
  system: string;
  user: string;
  tools: ReadonlyArray<ToolDefinition>;
  /**
   * Called for each tool_use block Claude emits.
   * Must return a ToolResult with the tool's output as a string.
   */
  toolExecutor: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolUseId: string,
  ) => Promise<ToolResult>;
  outputSchema: SchemaLike<T>;
  maxTokens?: number;
  temperature?: number;
  /** Maximum number of tool-use rounds before forcing a final text response. Default: 3 */
  maxToolRounds?: number;
}

type ContentBlock = {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
};

type Message = {
  role: string;
  content: unknown;
};

// ─── Helper ───────────────────────────────────────────────────────────────────

/**
 * Extract the final text from a Bedrock response content array.
 * Joins all text blocks, ignoring tool_use blocks.
 */
const extractText = (content: ContentBlock[]): string =>
  content
    .filter(c => c.type === 'text')
    .map(c => c.text ?? '')
    .join('\n')
    .trim();

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Invoke Claude with a tool-use loop and return the parsed, validated output.
 *
 * @throws If the model returns no usable text after all rounds.
 * @throws If the final text cannot be parsed against outputSchema.
 */
export const invokeClaudeWithTools = async <T>(
  args: InvokeClaudeWithToolsArgs<T>,
): Promise<T> => {
  const {
    modelId,
    system,
    user,
    tools,
    toolExecutor,
    outputSchema,
    maxTokens = 8000,
    temperature = 0.2,
    maxToolRounds = 3,
  } = args;

  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: user }] },
  ];

  let rawText = '';
  let toolRounds = 0;

  while (toolRounds <= maxToolRounds) {
    const isLastRound = toolRounds >= maxToolRounds;

    const requestBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: system }],
      messages,
      max_tokens: maxTokens,
      temperature,
    };

    // Offer tools only in non-final rounds; on the last round force text output
    if (!isLastRound && tools.length > 0) {
      requestBody.tools = tools;
    }

    const responseBody = await invokeModel(modelId, JSON.stringify(requestBody));
    const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as {
      stop_reason?: string;
      content?: ContentBlock[];
    };

    const stopReason = parsed.stop_reason ?? 'end_turn';
    const content: ContentBlock[] = parsed.content ?? [];

    // Detect truncation due to max_tokens and retry with higher limit
    if (stopReason === 'max_tokens' && !isLastRound) {
      const partialText = extractText(content);
      const newMaxTokens = maxTokens * TRUNCATION_RETRY_TOKEN_MULTIPLIER;
      console.warn(
        `[bedrock-tool-loop] Response truncated (stop_reason=max_tokens, ${partialText.length} chars). ` +
        `Retrying with max_tokens=${newMaxTokens} (was ${maxTokens})`,
      );

      // Add the partial response and ask Claude to continue
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Your previous response was truncated. Please generate the complete JSON response. Output ONLY the full JSON object, no explanatory text.' }],
      });

      const retryBody: Record<string, unknown> = {
        anthropic_version: 'bedrock-2023-05-31',
        system: [{ type: 'text', text: system }],
        messages,
        max_tokens: newMaxTokens,
        temperature,
      };

      const retryResponse = await invokeModel(modelId, JSON.stringify(retryBody));
      const retryParsed = JSON.parse(new TextDecoder('utf-8').decode(retryResponse)) as {
        stop_reason?: string;
        content?: ContentBlock[];
      };

      rawText = extractText(retryParsed.content ?? []);

      if (retryParsed.stop_reason === 'max_tokens') {
        console.warn(`[bedrock-tool-loop] Retry also truncated (${rawText.length} chars). Will attempt JSON repair.`);
      } else {
        console.log(`[bedrock-tool-loop] Retry succeeded (${rawText.length} chars)`);
      }

      break;
    }

    // If Claude wants to use tools and we still have rounds left, execute them
    if (stopReason === 'tool_use' && !isLastRound) {
      const toolUseBlocks = content.filter(c => c.type === 'tool_use');
      console.log(`[bedrock-tool-loop] Round ${toolRounds + 1}: ${toolUseBlocks.length} tool call(s)`);

      // Add assistant response to conversation
      messages.push({ role: 'assistant', content });

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        toolUseBlocks.map(block =>
          toolExecutor(
            block.name ?? '',
            (block.input ?? {}) as Record<string, unknown>,
            block.id ?? '',
          ),
        ),
      );

      // Add tool results as user message
      messages.push({
        role: 'user',
        content: toolResults.map(r => ({
          type: 'tool_result',
          tool_use_id: r.tool_use_id,
          content: r.content,
        })),
      });

      toolRounds++;
      continue;
    }

    // Extract final text response
    rawText = extractText(content);

    // If still no text on last round (Claude only returned tool_use), send a final prompt
    if (!rawText && stopReason === 'tool_use' && isLastRound) {
      console.warn('[bedrock-tool-loop] Last round still returned tool_use — sending final generation request');
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'IMPORTANT: Stop using tools. You have gathered enough information. Now output ONLY the complete JSON response — no explanatory text, no markdown fences, no reasoning. Start your response with { and end with }.' }],
      });

      const finalBody = {
        anthropic_version: 'bedrock-2023-05-31',
        system: [{ type: 'text', text: system }],
        messages,
        max_tokens: Math.max(maxTokens, 8000),
        temperature,
        // No tools — force text output
      };

      const finalResponse = await invokeModel(modelId, JSON.stringify(finalBody));
      const finalParsed = JSON.parse(new TextDecoder('utf-8').decode(finalResponse)) as {
        content?: ContentBlock[];
      };
      rawText = extractText(finalParsed.content ?? []);
    }

    // If we got text but it has no JSON, ask again for JSON-only output
    if (rawText && !rawText.includes('{') && !rawText.includes('[')) {
      console.warn('[bedrock-tool-loop] Response contains text but no JSON — requesting JSON-only output');
      messages.push({ role: 'assistant', content: [{ type: 'text', text: rawText }] });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Your response must be a JSON object. Output ONLY valid JSON — no prose, no explanation, no markdown. Start with { and end with }.' }],
      });

      const jsonRetryBody = {
        anthropic_version: 'bedrock-2023-05-31',
        system: [{ type: 'text', text: system }],
        messages,
        max_tokens: Math.max(maxTokens, 8000),
        temperature: 0.1,
      };

      const jsonRetryResponse = await invokeModel(modelId, JSON.stringify(jsonRetryBody));
      const jsonRetryParsed = JSON.parse(new TextDecoder('utf-8').decode(jsonRetryResponse)) as {
        content?: ContentBlock[];
      };
      const retryText = extractText(jsonRetryParsed.content ?? []);
      if (retryText && (retryText.includes('{') || retryText.includes('['))) {
        rawText = retryText;
        console.log(`[bedrock-tool-loop] JSON retry succeeded (${rawText.length} chars)`);
      }
    }

    console.log(`[bedrock-tool-loop] Complete after ${toolRounds} tool round(s), ${rawText.length} chars`);
    break;
  }

  if (!rawText.trim()) {
    throw new Error('[bedrock-tool-loop] Model returned no text content after all rounds');
  }

  return safeJsonParse(rawText, outputSchema);
};
