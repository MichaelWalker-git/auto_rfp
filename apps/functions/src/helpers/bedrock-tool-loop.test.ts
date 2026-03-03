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

  it('forces final generation after maxToolRounds', async () => {
    // All rounds return tool_use
    const toolUseResponse = {
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'search_knowledge_base', input: {} }],
    };
    const finalResponse = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"title":"Forced Final"}' }],
    };

    // 3 tool rounds + 1 final forced call
    mockInvokeModel
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(toolUseResponse))
      .mockResolvedValueOnce(encodeResponse(toolUseResponse)) // last round still tool_use
      .mockResolvedValueOnce(encodeResponse(finalResponse));  // forced final

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
});
