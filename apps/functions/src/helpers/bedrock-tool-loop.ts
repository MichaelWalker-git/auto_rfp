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
        content: [{ type: 'text', text: 'Now generate the complete JSON response based on all the information gathered.' }],
      });

      const finalBody = {
        anthropic_version: 'bedrock-2023-05-31',
        system: [{ type: 'text', text: system }],
        messages,
        max_tokens: maxTokens,
        temperature,
        // No tools — force text output
      };

      const finalResponse = await invokeModel(modelId, JSON.stringify(finalBody));
      const finalParsed = JSON.parse(new TextDecoder('utf-8').decode(finalResponse)) as {
        content?: ContentBlock[];
      };
      rawText = extractText(finalParsed.content ?? []);
    }

    console.log(`[bedrock-tool-loop] Complete after ${toolRounds} tool round(s), ${rawText.length} chars`);
    break;
  }

  if (!rawText.trim()) {
    throw new Error('[bedrock-tool-loop] Model returned no text content after all rounds');
  }

  return safeJsonParse(rawText, outputSchema);
};
