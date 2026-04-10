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
    maxToolRounds = 5,
  } = args;

  // Allow up to 2 extra rounds beyond maxToolRounds if the model keeps requesting tools
  const absoluteMax = maxToolRounds + 2;

  const messages: Message[] = [
    { role: 'user', content: [{ type: 'text', text: user }] },
  ];

  let rawText = '';
  let toolRounds = 0;

  while (toolRounds <= absoluteMax) {
    const isLastRound = toolRounds >= absoluteMax;

    const requestBody: Record<string, unknown> = {
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: system }],
      messages,
      max_tokens: maxTokens,
      temperature,
    };

    // Offer tools up to maxToolRounds; after that, force text-only output
    const offerTools = toolRounds < maxToolRounds && tools.length > 0;
    if (offerTools) {
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
    if (stopReason === 'tool_use' && offerTools) {
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

    // No text extracted — prompt the model to produce JSON
    if (!rawText && !isLastRound) {
      const reason = stopReason === 'tool_use'
        ? 'model returned tool_use without tools offered'
        : `model returned empty text (stop_reason=${stopReason})`;
      console.warn(`[bedrock-tool-loop] Round ${toolRounds}: ${reason} — prompting for JSON`);
      messages.push({ role: 'assistant', content });
      messages.push({
        role: 'user',
        content: [{ type: 'text', text: 'Generate the complete JSON response now based on all information gathered. Output ONLY the raw JSON object, no explanation or markdown.' }],
      });
      toolRounds++;
      continue;
    }

    console.log(`[bedrock-tool-loop] Complete after ${toolRounds} tool round(s), ${rawText.length} chars`);
    break;
  }

  if (!rawText.trim()) {
    throw new Error('[bedrock-tool-loop] Model returned no text content after all rounds');
  }

  // If the model returned text that doesn't contain JSON, retry with a strict JSON-only prompt
  try {
    return safeJsonParse(rawText, outputSchema);
  } catch (parseErr) {
    console.warn('[bedrock-tool-loop] Initial parse failed, retrying with strict JSON prompt:', (parseErr as Error)?.message);

    messages.push({ role: 'assistant', content: [{ type: 'text', text: rawText }] });
    messages.push({
      role: 'user',
      content: [{ type: 'text', text: 'Your response must be ONLY a valid JSON object. No explanation, no markdown, no commentary — just the raw JSON. Output the complete JSON now:' }],
    });

    const retryBody = {
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: system }],
      messages,
      max_tokens: maxTokens,
      temperature: Math.max(temperature - 0.1, 0),
    };

    const retryResponse = await invokeModel(modelId, JSON.stringify(retryBody));
    const retryParsed = JSON.parse(new TextDecoder('utf-8').decode(retryResponse)) as {
      content?: ContentBlock[];
    };
    const retryText = extractText(retryParsed.content ?? []);

    if (!retryText.trim()) {
      throw new Error('[bedrock-tool-loop] Retry also returned no text content');
    }

    return safeJsonParse(retryText, outputSchema);
  }
};
