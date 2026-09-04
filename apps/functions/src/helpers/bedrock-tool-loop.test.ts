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
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';

import { invokeClaudeWithTools } from './bedrock-tool-loop';
import type { ToolResult } from '@/types/tool';

const MODEL_ID = 'anthropic.claude-3-sonnet-20240229-v1:0';

const SIMPLE_SCHEMA = {
  parse: (v: unknown) => v as { title: string },
};

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

  it('forces text output after maxToolRounds and returns JSON', async () => {
    const toolUseResponse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'search_knowledge_base', input: {} }],
    };
    const finalResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"title":"Forced Final"}' }],
    };

    // maxToolRounds=2, absoluteMax=4
    // Round 0: tools offered → tool_use → execute tool
    // Round 1: tools offered → tool_use → execute tool
    // Round 2: no tools → tool_use → prompt for JSON
    // Round 3: no tools → returns final text
    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(finalResponse));

    const result = await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'System',
      user: 'User',
      tools: [{ name: 'search_knowledge_base', description: 'Search', input_schema: { type: 'object' as const, properties: {}, required: [] } }],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
      maxToolRounds: 2,
    });

    expect(result).toEqual({ title: 'Forced Final' });
    // Only 2 tool executions (rounds 0 and 1)
    expect(mockToolExecutor).toHaveBeenCalledTimes(2);
  });

  it('throws when model returns no text after all rounds', async () => {
    const emptyResponse = { stop_reason: 'end_turn', content: [] };
    // absoluteMax = 0 + 2 = 2, so up to 3 iterations + 1 JSON retry
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
    ).rejects.toThrow('Model returned no text content after all rounds');
  });

  it('executes multiple tool calls in parallel within a single round', async () => {
    const MOCK_TOOLS = [
      { name: 'search_knowledge_base', description: 'Search KB', input_schema: { type: 'object' as const, properties: {}, required: [] } },
      { name: 'search_past_performance', description: 'Search PP', input_schema: { type: 'object' as const, properties: {}, required: [] } },
    ];

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
      tools: MOCK_TOOLS,
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    expect(mockToolExecutor).toHaveBeenCalledTimes(2);
    expect(mockToolExecutor).toHaveBeenCalledWith('search_knowledge_base', { query: 'certs' }, 'tool-1');
    expect(mockToolExecutor).toHaveBeenCalledWith('search_past_performance', { keywords: 'cloud' }, 'tool-2');
  });
});

describe('invokeClaudeWithTools — orgId propagation', () => {
  const ORG_ID = 'org-xyz';

  it('threads orgId to every invoke across tool-use rounds', async () => {
    const toolUseResponse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'search_knowledge_base', input: {} }],
    };
    const finalResponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"Done"}' }] };

    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(finalResponse));

    await invokeClaudeWithTools({
      modelId: MODEL_ID,
      orgId: ORG_ID,
      system: 'System',
      user: 'User',
      tools: [{ name: 'search_knowledge_base', description: 'Search', input_schema: { type: 'object' as const, properties: {}, required: [] } }],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    expect(mockInvokeModel).toHaveBeenCalledTimes(2);
    // Every internal invoke — main round and the follow-up round — carries orgId as the 3rd arg.
    for (const call of mockInvokeModel.mock.calls) {
      expect(call[0]).toBe(MODEL_ID);
      expect(call[2]).toBe(ORG_ID);
    }
  });

  it('threads orgId through the truncation retry', async () => {
    const truncated = { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"title":"partia' }] };
    const completed = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"Complete"}' }] };

    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(truncated))
      .mockResolvedValueOnce(encodeResponse(completed));

    await invokeClaudeWithTools({
      modelId: MODEL_ID,
      orgId: ORG_ID,
      system: 'System',
      user: 'User',
      tools: [],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    expect(mockInvokeModel).toHaveBeenCalledTimes(2);
    // The truncation-retry invoke (2nd call) must carry orgId too.
    expect(mockInvokeModel.mock.calls[1]?.[2]).toBe(ORG_ID);
  });

  it('threads orgId through the JSON-repair retry', async () => {
    const nonJson = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'this is not json' }] };
    const repaired = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"Repaired"}' }] };

    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(nonJson))
      .mockResolvedValueOnce(encodeResponse(repaired));

    const result = await invokeClaudeWithTools({
      modelId: MODEL_ID,
      orgId: ORG_ID,
      system: 'System',
      user: 'User',
      tools: [],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    expect(result).toEqual({ title: 'Repaired' });
    expect(mockInvokeModel).toHaveBeenCalledTimes(2);
    // The JSON-repair invoke (2nd call) must carry orgId too.
    expect(mockInvokeModel.mock.calls[1]?.[2]).toBe(ORG_ID);
  });
});

describe('invokeClaudeWithTools — empty-content handling', () => {
  it('does not push empty assistant content back into the conversation', async () => {
    const emptyResponse = { stop_reason: 'end_turn', content: [] };
    const finalResponse = { stop_reason: 'end_turn', content: [{ type: 'text', text: '{"title":"Recovered"}' }] };

    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(emptyResponse))
      .mockResolvedValueOnce(encodeResponse(finalResponse));

    const result = await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'System',
      user: 'User',
      tools: [],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
    });

    expect(result).toEqual({ title: 'Recovered' });
    expect(mockInvokeModel).toHaveBeenCalledTimes(2);

    const secondCallBody = JSON.parse(mockInvokeModel.mock.calls[1]?.[1] as string) as {
      messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
    };
    const assistantMessages = secondCallBody.messages.filter(m => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);
    for (const message of assistantMessages) {
      expect(Array.isArray(message.content)).toBe(true);
      expect(message.content.length).toBeGreaterThan(0);
    }
  });

  it('salvages a final answer when all tool rounds return empty content', async () => {
    const emptyResponse = { stop_reason: 'end_turn', content: [] };
    const salvageResponse = { content: [{ type: 'text', text: '{"title":"Salvaged"}' }] };

    // maxToolRounds=0 → absoluteMax=2 → rounds 0,1,2 all return empty, then one salvage call.
    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(emptyResponse))
      .mockResolvedValueOnce(encodeResponse(emptyResponse))
      .mockResolvedValueOnce(encodeResponse(emptyResponse))
      .mockResolvedValueOnce(encodeResponse(salvageResponse));

    const result = await invokeClaudeWithTools({
      modelId: MODEL_ID,
      system: 'System',
      user: 'User',
      tools: [],
      toolExecutor: mockToolExecutor,
      outputSchema: SIMPLE_SCHEMA,
      maxToolRounds: 0,
    });

    expect(result).toEqual({ title: 'Salvaged' });
    expect(mockInvokeModel).toHaveBeenCalledTimes(4);
  });

  it('still throws when salvage also returns empty', async () => {
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
    ).rejects.toThrow('including salvage');
  });
});
