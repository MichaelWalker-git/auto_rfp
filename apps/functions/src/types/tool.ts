/**
 * Shared type definitions for AI tool use (Claude tool_use format).
 * Used by both document-tools.ts and brief-tools.ts.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: readonly string[];
  };
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
}
