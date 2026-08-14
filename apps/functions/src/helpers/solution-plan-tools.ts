/**
 * solution-plan-tools.ts
 *
 * Tool set offered to the Tech Lead agent during the Solution Plan grilling
 * loop (T6): the org-grounding subset of DOCUMENT_TOOLS plus
 * `search_service_pricing` for third-party price lookups (real Brave-backed
 * lookup since T3).
 *
 * The executor delegates every tool to `executeDocumentTool` so behavior
 * (and tool-usage audit logging) stays identical to document generation.
 */

import { DOCUMENT_TOOLS, executeDocumentTool } from './document-tools';
import type { ToolDefinition, ToolResult } from '@/types/tool';

/** Cap on a transcript tool-call summary — one line for the UI, not the payload. */
const TOOL_SUMMARY_CHAR_CAP = 200;

/**
 * One-line summary of a tool call for the grilling transcript UI. Lives next
 * to the tool definitions because it encodes each tool's input shape: the
 * shared DOCUMENT_TOOLS take `query`/`keywords`/`topic`, search_service_pricing
 * takes `services`.
 */
export const summarizeToolInput = (toolInput: Record<string, unknown>): string => {
  const interesting = toolInput.query ?? toolInput.keywords ?? toolInput.topic ?? toolInput.services;
  if (interesting === undefined) return '';
  const text = typeof interesting === 'string' ? interesting : JSON.stringify(interesting);
  return text.length > TOOL_SUMMARY_CHAR_CAP ? text.slice(0, TOOL_SUMMARY_CHAR_CAP) : text;
};

// ─── Tool set ───────────────────────────────────────────────────────────────────

/**
 * DOCUMENT_TOOLS offered to the Tech Lead (ROADMAP §2), including the
 * Brave-backed `search_service_pricing` (T3) — solution planning is exactly
 * the pricing-document use case that tool exists for.
 */
export const SOLUTION_PLAN_SHARED_TOOL_NAMES = [
  'search_knowledge_base',
  'search_past_performance',
  'get_organization_context',
  'get_pricing_data',
  'get_executive_brief_analysis',
  'search_service_pricing',
] as const;

const isSharedToolName = (name: string): boolean =>
  (SOLUTION_PLAN_SHARED_TOOL_NAMES as readonly string[]).includes(name);

export const SOLUTION_PLAN_TOOLS: ReadonlyArray<ToolDefinition> =
  DOCUMENT_TOOLS.filter((t) => isSharedToolName(t.name));

// ─── Dispatcher ─────────────────────────────────────────────────────────────────

/**
 * Execute one Tech Lead tool call. Never throws into the tool loop (ADR-15) —
 * failures come back as text the model can work around.
 */
export const executeSolutionPlanTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  projectId: string;
  opportunityId: string;
  solutionPlanId: string;
}): Promise<ToolResult> => {
  const { toolName, toolInput, toolUseId, orgId, projectId, opportunityId, solutionPlanId } = args;

  if (!isSharedToolName(toolName)) {
    return { tool_use_id: toolUseId, content: `Unknown tool: ${toolName}` };
  }

  // Delegate to the document-tools dispatcher (it catches its own errors).
  // The plan id doubles as the audit-log resource id; grilling has no Q&A set.
  return executeDocumentTool({
    toolName,
    toolInput,
    toolUseId,
    orgId,
    projectId,
    opportunityId,
    documentId: solutionPlanId,
    qaPairs: [],
  });
};
