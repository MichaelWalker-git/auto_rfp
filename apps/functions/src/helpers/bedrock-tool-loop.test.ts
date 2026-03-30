jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: mockInvokeModel,
}));

jest.mock('@/helpers/executive-opportunity-brief', () => ({
  safeJsonParse: jest.fn((text: string, schema: { parse: (v: unknown) => unknown }) => {
    const parsed = JSON.parse(text);
    return schema.parse(parsed);
  }),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-opus-4-6-v1';

import { z } from 'zod';
import { invokeClaudeWithTools } from './bedrock-tool-loop';
import type { ToolResult } from '@/types/tool';

const MODEL_ID = 'anthropic.claude-opus-4-6-v1';

const SIMPLE_SCHEMA = {
  parse: (v: unknown) => v as { title: string },
};

/** A Zod schema that triggers the tool_choice path */
const ZOD_SCHEMA = z.object({
  title: z.string(),
  score: z.number().optional(),
});

const encodeResponse = (body: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(body));

const mockToolExecutor = jest.fn(
  async (_toolName: string, _toolInput: Record<string, unknown>, toolUseId: string): Promise<ToolResult> => ({
    tool_use_id: toolUseId,
    content: 'Tool result content',
  }),
);

beforeEach(() => {
  jest.clearAllMocks();
  mockInvokeModel.mockReset();
  mockToolExecutor.mockClear();
});

describe('invokeClaudeWithTools', () => {
  it('returns parsed output when model responds with text on first call', async () => {
    const responseBody = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"Test Document"}' }] };
    mockInvokeModel.mockResolvedValueOnce(encodeResponse(responseBody));

    const result = await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'You are a helpful assistant.',
      user: 'Generate a document.',
      tools: [],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    expect(result).toEqual({ title: 'Test Document' });
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(mockToolExecutor).not.toHaveBeenCalled();
  });

  it('executes tools and continues conversation when stop_reason is tool_use', async () => {
    // Round 1: Claude wants to use a tool
    const toolUseResponse = {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'search_knowledge_base', input: { query: 'certifications' } },
      ],
    };
    // Round 2: Claude returns final text
    const finalResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"title":"Final Document"}' }],
    };

    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(finalResponse));

    const result = await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'You are a helpful assistant.',
      user: 'Generate a document.',
      tools: [{ name: 'search_knowledge_base', description: 'Search KB', input_schema: { type: 'object', properties: {}, required: [] } }],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    expect(result).toEqual({ title: 'Final Document' });
    expect(mockInvokeModel).toHaveBeenCalledTimes(2);
    expect(mockToolExecutor).toHaveBeenCalledTimes(1);
    expect(mockToolExecutor).toHaveBeenCalledWith('search_knowledge_base', { query: 'certifications' }, 'tool-1');
  });

  it('forces text-only generation on last round when no JSON Schema (non-Zod schema)', async () => {
    // Rounds 0-2: model returns tool_use, tools are executed
    const toolUseResponse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'search_knowledge_base', input: {} }],
    };
    // Round 3 (last round): no tools provided, model forced to output text
    const finalResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"title":"Forced Final"}' }],
    };

    // 3 tool rounds + 1 final text-only call (tools omitted on last round)
    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(finalResponse)); // last round: text-only (no tools)

    const result = await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'System',
      user: 'User',
      tools: [{ name: 'search_knowledge_base', description: 'Search', input_schema: { type: 'object', properties: {}, required: [] } }],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
      maxToolRounds: 3,
    });

    expect(result).toEqual({ title: 'Forced Final' });
    // 3 tool rounds + 1 final text-only = 4 calls total
    expect(mockInvokeModel).toHaveBeenCalledTimes(4);

    // Verify the last call has no tools (forces text output)
    const lastCallArgs = JSON.parse(mockInvokeModel.mock.calls[3][1]);
    expect(lastCallArgs.tools).toBeUndefined();
  });

  it('throws when model returns no text after all rounds', async () => {
    const emptyResponse = { stop_reason: 'end_turn', content: [] };
    mockInvokeModel.mockResolvedValue(encodeResponse(emptyResponse));

    await expect(
      invokeClaudeWithTools({
        modelId: MODEL_ID,
        system: 'System',
        user: 'User',
        tools: [],
        toolExecutor: mockToolExecutor,
        outputSchema: SIMPLE_SCHEMA,
        maxToolRounds: 0,
      }),
    ).rejects.toThrow('[bedrock-tool-loop] Model returned no text content after all rounds');
  });

  it('retries with JSON-only prompt when model returns prose instead of JSON', async () => {
    // First call: model returns prose text (no JSON)
    const proseResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Let me refine my analysis with a more accurate estimate based on the enterprise pricing model.' }],
    };
    // Final retry: model returns valid JSON
    const jsonResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"title":"Pricing Analysis"}' }],
    };

    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(proseResponse))  // initial: prose
      .mockResolvedValueOnce(encodeResponse(jsonResponse));   // JSON-only retry succeeds

    const result = await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'You are a pricing analyst.',
      user: 'Analyze pricing.',
      tools: [],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
      maxToolRounds: 0,
    });

    expect(result).toEqual({ title: 'Pricing Analysis' });
    // Should have called invokeModel twice: once for initial, once for JSON retry
    expect(mockInvokeModel).toHaveBeenCalledTimes(2);
  });

  it('includes JSON enforcement in system prompt', async () => {
    const responseBody = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"Test"}' }] };
    mockInvokeModel.mockResolvedValueOnce(encodeResponse(responseBody));

    await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'You are a helpful assistant.',
      user: 'Generate output.',
      tools: [],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    const callArgs = JSON.parse(mockInvokeModel.mock.calls[0][1]);
    expect(callArgs.system[0].text).toContain('MUST be a single valid JSON object');
  });

  it('executes multiple tool calls in parallel within a single round', async () => {
    const toolUseResponse = {
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'tool-1', name: 'search_knowledge_base', input: { query: 'certs' } },
        { type: 'tool_use', id: 'tool-2', name: 'search_past_performance', input: { keywords: 'cloud' } },
      ],
    };
    const finalResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"title":"Multi-tool Result"}' }],
    };

    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(finalResponse));

    await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'System',
      user: 'User',
      tools: [],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    expect(mockToolExecutor).toHaveBeenCalledTimes(2);
    expect(mockToolExecutor).toHaveBeenCalledWith('search_knowledge_base', { query: 'certs' }, 'tool-1');
    expect(mockToolExecutor).toHaveBeenCalledWith('search_past_performance', { keywords: 'cloud' }, 'tool-2');
  });

  // ─── tool_choice structured_output tests ─────────────────────────────────────

  describe('tool_choice structured_output (Zod schema)', () => {
    it('uses tool_choice on the final round with a Zod outputSchema', async () => {
      // Round 1: tool use
      const toolUseResponse = {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'search_knowledge_base', input: { query: 'test' } },
        ],
      };
      // Round 2 (final): model returns structured_output via tool_choice
      const structuredResponse = {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'so-1', name: 'structured_output', input: { title: 'Structured Result', score: 85 } },
        ],
      };

      mockInvokeModel
        .mockResolvedValueOnce(encodeResponse(toolUseResponse))
        .mockResolvedValueOnce(encodeResponse(structuredResponse));

      const result = await invokeClaudeWithTools({
        modelId: MODEL_ID,
        system: 'System',
        user: 'User',
        tools: [{ name: 'search_knowledge_base', description: 'Search', input_schema: { type: 'object', properties: {}, required: [] } }],
        toolExecutor: mockToolExecutor,
        outputSchema: ZOD_SCHEMA,
        maxToolRounds: 1,
      });

      expect(result).toEqual({ title: 'Structured Result', score: 85 });
      expect(mockInvokeModel).toHaveBeenCalledTimes(2);

      // Verify the final request includes tool_choice and ONLY structured_output tool
      // (regular tools are omitted on the last round to prevent tool loops)
      const finalCallArgs = JSON.parse(mockInvokeModel.mock.calls[1][1]);
      expect(finalCallArgs.tool_choice).toEqual({ type: 'tool', name: 'structured_output' });
      const toolNames = finalCallArgs.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain('structured_output');
      expect(toolNames).not.toContain('search_knowledge_base');
      expect(finalCallArgs.tools).toHaveLength(1);
    });

    it('uses tool_choice on first call when maxToolRounds is 0 with Zod schema', async () => {
      const structuredResponse = {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'so-1', name: 'structured_output', input: { title: 'Direct Output' } },
        ],
      };

      mockInvokeModel.mockResolvedValueOnce(encodeResponse(structuredResponse));

      const result = await invokeClaudeWithTools({
        modelId: MODEL_ID,
        system: 'System',
        user: 'User',
        tools: [],
        toolExecutor: mockToolExecutor,
        outputSchema: ZOD_SCHEMA,
        maxToolRounds: 0,
      });

      expect(result).toEqual({ title: 'Direct Output' });
      expect(mockInvokeModel).toHaveBeenCalledTimes(1);

      // Verify tool_choice was set
      const callArgs = JSON.parse(mockInvokeModel.mock.calls[0][1]);
      expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'structured_output' });
    });

    it('uses explicit outputJsonSchema when provided', async () => {
      const structuredResponse = {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'so-1', name: 'structured_output', input: { title: 'Custom Schema' } },
        ],
      };

      mockInvokeModel.mockResolvedValueOnce(encodeResponse(structuredResponse));

      const customJsonSchema = {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
      };

      // Use non-Zod schema but provide explicit JSON Schema
      const result = await invokeClaudeWithTools({
        modelId: MODEL_ID,
        system: 'System',
        user: 'User',
        tools: [],
        toolExecutor: mockToolExecutor,
        outputSchema: SIMPLE_SCHEMA,
        outputJsonSchema: customJsonSchema,
        maxToolRounds: 0,
      });

      expect(result).toEqual({ title: 'Custom Schema' });

      // Verify the structured_output tool uses the custom schema
      const callArgs = JSON.parse(mockInvokeModel.mock.calls[0][1]);
      expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'structured_output' });
      const soTool = callArgs.tools.find((t: { name: string }) => t.name === 'structured_output');
      expect(soTool.input_schema.properties).toEqual({ title: { type: 'string' } });
    });

    it('falls back to text extraction when tool_choice returns no structured_output block', async () => {
      // Model returns text instead of structured_output (unexpected but possible)
      const textResponse = {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"title":"Fallback Text"}' }],
      };

      mockInvokeModel.mockResolvedValueOnce(encodeResponse(textResponse));

      const result = await invokeClaudeWithTools({
        modelId: MODEL_ID,
        system: 'System',
        user: 'User',
        tools: [],
        toolExecutor: mockToolExecutor,
        outputSchema: ZOD_SCHEMA,
        maxToolRounds: 0,
      });

      expect(result).toEqual({ title: 'Fallback Text' });
    });

    it('validates tool_choice output through outputSchema.parse()', async () => {
      const structuredResponse = {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'so-1', name: 'structured_output', input: { title: 123 } }, // invalid: title should be string
        ],
      };

      mockInvokeModel.mockResolvedValueOnce(encodeResponse(structuredResponse));

      await expect(
        invokeClaudeWithTools({
          modelId: MODEL_ID,
          system: 'System',
          user: 'User',
          tools: [],
          toolExecutor: mockToolExecutor,
          outputSchema: ZOD_SCHEMA,
          maxToolRounds: 0,
        }),
      ).rejects.toThrow(); // Zod validation fails
    });
  });
});
