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
import { loadRawSolicitationDocuments, truncateText, type BriefSectionName } from './executive-opportunity-brief';
import { SOLUTION_PLAN_BRIEF_SECTIONS } from './solution-plan-prompts';
import type { ToolDefinition, ToolResult } from '@/types/tool';

/** Cap on a transcript tool-call summary — one line for the UI, not the payload. */
const TOOL_SUMMARY_CHAR_CAP = 200;

/**
 * One-line summary of a tool call for the grilling transcript UI. Lives next
 * to the tool definitions because it encodes each tool's input shape: the
 * shared DOCUMENT_TOOLS take `query`/`keywords`/`topic`, search_service_pricing
 * takes `services`, fetch_solicitation_section takes `documentName`.
 */
export const summarizeToolInput = (toolInput: Record<string, unknown>): string => {
  const interesting =
    toolInput.documentName ?? toolInput.query ?? toolInput.keywords ?? toolInput.topic ?? toolInput.services;
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

/** Name of the solicitation coverage plan's own tool — not part of DOCUMENT_TOOLS. */
export const FETCH_SOLICITATION_SECTION_TOOL_NAME = 'fetch_solicitation_section';

/**
 * Lets the Tech Lead pull a focused section from a solicitation document on
 * demand, regardless of whether the round context sent full text or a
 * SUMMARIZED manifest (docs/SOLICITATION-COVERAGE-PLAN.md, Layer B).
 */
const FETCH_SOLICITATION_SECTION_TOOL: ToolDefinition = {
  name: FETCH_SOLICITATION_SECTION_TOOL_NAME,
  description:
    'Fetch a focused section from one of the solicitation documents listed in the manifest or ' +
    'solicitation text. Use this to pull specific requirements, pricing, or evaluation criteria ' +
    'beyond what the primer already shows you.',
  input_schema: {
    type: 'object' as const,
    properties: {
      documentName: {
        type: 'string',
        description: 'Document name exactly as it appears in the manifest or the "--- Document N: name ---" marker.',
      },
      keywords: {
        type: 'array',
        items: { type: 'string' },
        description: 'Keywords to search for. Returns ~3,000 characters of context around the first match.',
      },
      sectionHint: {
        type: 'string',
        description: 'A heading fragment. Returns the enclosing section.',
      },
    },
    required: ['documentName'],
  },
};

export const SOLUTION_PLAN_TOOLS: ReadonlyArray<ToolDefinition> = [
  ...DOCUMENT_TOOLS.filter((t) => isSharedToolName(t.name)),
  FETCH_SOLICITATION_SECTION_TOOL,
];

// ─── fetch_solicitation_section ─────────────────────────────────────────────────

/** ± context window around a keyword match, and the hard cap on any tool response. */
const KEYWORD_CONTEXT_CHARS = 3_000;
const FETCH_SECTION_RESULT_CHAR_CAP = 6_000;

/** Lines that look like a heading: short, and either numbered ("2.1 Scope") or Title/ALL-CAPS-ish. */
const HEADING_LINE_PATTERN = /^(?:\d+(?:\.\d+)*\s+\S.{0,80}|[A-Z][A-Z0-9 .,:'&()/-]{3,80})$/;

const buildOutline = (text: string): string => {
  const headings = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= 100 && HEADING_LINE_PATTERN.test(line));
  return headings.length ? headings.slice(0, 60).join('\n') : text.slice(0, FETCH_SECTION_RESULT_CHAR_CAP);
};

const findKeywordWindow = (text: string, keyword: string): string | null => {
  if (!keyword.trim()) return null;
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - KEYWORD_CONTEXT_CHARS);
  const end = Math.min(text.length, idx + keyword.length + KEYWORD_CONTEXT_CHARS);
  return text.slice(start, end);
};

/** From the first line matching `hint` to just before the next heading-like line. */
const findSectionWindow = (text: string, hint: string): string | null => {
  if (!hint.trim()) return null;
  const lines = text.split('\n');
  const startIdx = lines.findIndex((line) => line.toLowerCase().includes(hint.toLowerCase()));
  if (startIdx === -1) return null;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (HEADING_LINE_PATTERN.test(lines[i]!.trim())) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n');
};

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Executor for `fetch_solicitation_section`: case-insensitive keyword or
 * heading search over one document's cached extracted text, returning up to
 * `FETCH_SECTION_RESULT_CHAR_CAP` chars so the transcript never balloons.
 * Falls back to the document's outline when neither `keywords` nor
 * `sectionHint` is given, or when nothing matches.
 */
export const executeFetchSolicitationSection = async (args: {
  toolInput: Record<string, unknown>;
  toolUseId: string;
  projectId: string;
  opportunityId: string;
}): Promise<ToolResult> => {
  const { toolInput, toolUseId, projectId, opportunityId } = args;
  const documentName = typeof toolInput.documentName === 'string' ? toolInput.documentName : '';
  const keywords = asStringArray(toolInput.keywords);
  const sectionHint = typeof toolInput.sectionHint === 'string' ? toolInput.sectionHint : '';

  try {
    const docs = await loadRawSolicitationDocuments(projectId, opportunityId);
    const doc = docs.find((d) => d.fileName === documentName);
    if (!doc) {
      const available = docs.map((d) => d.fileName).join(', ') || '(none)';
      return {
        tool_use_id: toolUseId,
        content: `Unknown document "${documentName}". Available documents: ${available}`,
      };
    }

    let content: string;
    if (keywords.length) {
      const match = keywords.map((k) => findKeywordWindow(doc.text, k)).find((w): w is string => w !== null);
      content =
        match ??
        `No match for keywords [${keywords.join(', ')}] in "${documentName}". Outline:\n${buildOutline(doc.text)}`;
    } else if (sectionHint) {
      content =
        findSectionWindow(doc.text, sectionHint) ??
        `No section matching "${sectionHint}" in "${documentName}". Outline:\n${buildOutline(doc.text)}`;
    } else {
      content = `Outline of "${documentName}":\n${buildOutline(doc.text)}`;
    }

    return { tool_use_id: toolUseId, content: truncateText(content, FETCH_SECTION_RESULT_CHAR_CAP) };
  } catch (err) {
    return {
      tool_use_id: toolUseId,
      content: `fetch_solicitation_section failed: ${(err as Error)?.message ?? 'unknown error'}`,
    };
  }
};

// ─── Dispatcher ─────────────────────────────────────────────────────────────────

/**
 * Constrain a `get_executive_brief_analysis` request to the sections the plan
 * may see (SOLUTION_PLAN_BRIEF_SECTIONS — never `scoring`, which carries the
 * bid/no-bid decision). An absent, invalid, or fully-disallowed request falls
 * back to the whole allowed list.
 */
const sanitizeBriefSections = (requested: unknown): BriefSectionName[] => {
  const allowed = (Array.isArray(requested) ? requested : []).filter(
    (s): s is BriefSectionName =>
      (SOLUTION_PLAN_BRIEF_SECTIONS as readonly string[]).includes(String(s)),
  );
  return allowed.length ? allowed : [...SOLUTION_PLAN_BRIEF_SECTIONS];
};

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

  if (toolName === FETCH_SOLICITATION_SECTION_TOOL_NAME) {
    return executeFetchSolicitationSection({ toolInput, toolUseId, projectId, opportunityId });
  }

  if (!isSharedToolName(toolName)) {
    return { tool_use_id: toolUseId, content: `Unknown tool: ${toolName}` };
  }

  const sanitizedInput =
    toolName === 'get_executive_brief_analysis'
      ? { ...toolInput, sections: sanitizeBriefSections(toolInput.sections) }
      : toolInput;

  // Delegate to the document-tools dispatcher (it catches its own errors).
  // The plan id doubles as the audit-log resource id; grilling has no Q&A set.
  return executeDocumentTool({
    toolName,
    toolInput: sanitizedInput,
    toolUseId,
    orgId,
    projectId,
    opportunityId,
    documentId: solutionPlanId,
    qaPairs: [],
  });
};
