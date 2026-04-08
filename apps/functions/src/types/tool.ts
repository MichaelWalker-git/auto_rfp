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

export interface ToolResultSource {
  id: string;
  documentId?: string;
  kbId?: string;
  chunkKey?: string;
  fileName?: string;
  relevance?: number;
  textContent?: string;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  similarityScores?: number[];
  sources?: ToolResultSource[];
  sourceCreatedDates?: string[];
}
