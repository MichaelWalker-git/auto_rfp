/**
 * Claude Tool Use definitions and executors for answer generation.
 *
 * These tools allow Claude to actively query the database during answer
 * generation rather than relying solely on pre-fetched context.
 *
 * Available tools (4 total):
 *  - search_knowledge_base    → semantic search over company KB chunks
 *  - search_past_performance  → semantic search over past projects
 *  - get_content_library      → search pre-approved Q&A pairs
 *  - get_organization_context → org details, primary contact, team
 */

import { getEmbedding, semanticSearchChunks, semanticSearchPastPerformance } from '@/helpers/embeddings';
import { loadTextFromS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import { truncateText } from '@/helpers/executive-opportunity-brief';
import {
  fetchOrganizationDetails,
  fetchOrgPrimaryContact,
  fetchContentLibraryMatches,
  logToolUsage,
} from '@/helpers/db-tool-helpers';
import type { ToolResult } from '@/types/tool';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { getItem } from '@/helpers/db';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── Tool schemas ─────────────────────────────────────────────────────────────

export const ANSWER_TOOLS = [
  {
    name: 'search_knowledge_base',
    description:
      'Search the company knowledge base for relevant information to answer the question. ' +
      'Use this to find specific facts, processes, certifications, capabilities, or any ' +
      'company-specific information that would help answer the question accurately.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query. Should be specific to what information you need.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of KB chunks to return (1–10). Default: 5.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_past_performance',
    description:
      'Search for relevant past performance projects that demonstrate experience ' +
      'related to the question. Use this when the question asks about past work, ' +
      'experience, capabilities, or relevant contracts.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'string',
          description: 'Keywords describing the type of work or experience needed.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (1–5). Default: 3.',
        },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'get_content_library',
    description:
      'Search the content library for pre-approved answers to similar questions. ' +
      'Use this when you need standard, vetted language for certifications, ' +
      'compliance statements, or recurring proposal topics.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query for content library.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of content items to return (1–5). Default: 3.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_organization_context',
    description:
      'Retrieve organization details and primary contact information. ' +
      'Use this when the question asks about company name, address, certifications, ' +
      'CAGE code, NAICS codes, business type, or contact information.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
] as const;

export type AnswerToolName = typeof ANSWER_TOOLS[number]['name'];

// ─── Tool executors ───────────────────────────────────────────────────────────

const executeKbSearch = async (
  orgId: string,
  query: string,
  limit = 5,
): Promise<string> => {
  const topK = Math.min(Math.max(limit, 1), 10);
  try {
    const embedding = await getEmbedding(query);
    const hits = await semanticSearchChunks(orgId, embedding, topK * 2);
    if (!hits.length) return 'No knowledge base content found for that query.';

    const relevant = hits.filter(h => (h.score ?? 0) >= 0.35).slice(0, topK);
    if (!relevant.length) return 'No sufficiently relevant knowledge base content found.';

    const chunks = await Promise.all(
      relevant.map(async (h, i) => {
        const chunkKey = h.source?.chunkKey;
        const text = chunkKey
          ? await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey).catch(() => '')
          : '';
        if (!text.trim()) return null;

        // Get document name from DynamoDB
        const pk = h.source?.[PK_NAME];
        const sk = h.source?.[SK_NAME];
        let docName = '';
        if (pk && sk) {
          const docItem = await getItem<Record<string, unknown>>(pk, sk).catch(() => null);
          docName = docItem?.name as string ?? '';
        }

        return `[KB ${i + 1}] (score: ${h.score?.toFixed(2)})${docName ? ` — ${docName}` : ''}\n${truncateText(text, 600)}`;
      }),
    );

    const valid = chunks.filter((c): c is string => c !== null);
    if (!valid.length) return 'Could not load knowledge base content.';

    return `Found ${valid.length} relevant KB excerpt(s):\n\n${valid.join('\n\n---\n\n')}`;
  } catch (err) {
    console.warn('search_knowledge_base (answer) error:', (err as Error)?.message);
    return `Error searching knowledge base: ${(err as Error)?.message}`;
  }
};

const executePastPerfSearch = async (
  orgId: string,
  keywords: string,
  limit = 3,
): Promise<string> => {
  const topK = Math.min(Math.max(limit, 1), 5);
  try {
    const embedding = await getEmbedding(keywords);
    const hits = await semanticSearchPastPerformance(orgId, embedding, topK * 2);
    if (!hits.length) return 'No past performance projects found matching those keywords.';

    const relevant = hits.filter(h => (h.score ?? 0) >= 0.35).slice(0, topK);
    if (!relevant.length) return 'No sufficiently relevant past performance found.';

    const formatted = relevant.map((h, i) => {
      const m = h.source as Record<string, unknown>;
      const lines: string[] = [`[PP ${i + 1}] (score: ${h.score?.toFixed(2)})`];
      if (m.title) lines.push(`Project: ${m.title}`);
      if (m.client) lines.push(`Client: ${m.client}`);
      if (m.domain) lines.push(`Domain: ${m.domain}`);
      if (m.value) lines.push(`Value: $${m.value}`);
      if (m.description) lines.push(`Description: ${truncateText(String(m.description), 300)}`);
      if (Array.isArray(m.technologies) && m.technologies.length) {
        lines.push(`Technologies: ${(m.technologies as string[]).slice(0, 6).join(', ')}`);
      }
      if (Array.isArray(m.achievements) && m.achievements.length) {
        lines.push('Achievements:');
        (m.achievements as string[]).slice(0, 3).forEach(a => lines.push(`  • ${a}`));
      }
      return lines.join('\n');
    });

    return `Found ${formatted.length} relevant past performance project(s):\n\n${formatted.join('\n\n---\n\n')}`;
  } catch (err) {
    console.warn('search_past_performance (answer) error:', (err as Error)?.message);
    return `Error searching past performance: ${(err as Error)?.message}`;
  }
};

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export const executeAnswerTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  questionId: string;
}): Promise<ToolResult> => {
  const { toolName, toolInput, toolUseId, orgId, questionId } = args;

  const start = Date.now();
  let content: string;
  let result: 'success' | 'failure' = 'success';
  let errorMessage: string | undefined;

  try {
    switch (toolName) {
      case 'search_knowledge_base':
        content = await executeKbSearch(
          orgId,
          String(toolInput.query ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 5,
        );
        break;

      case 'search_past_performance':
        content = await executePastPerfSearch(
          orgId,
          String(toolInput.keywords ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        break;

      case 'get_content_library':
        content = await fetchContentLibraryMatches(
          orgId,
          String(toolInput.query ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        if (!content) content = 'No content library matches found for that query.';
        break;

      case 'get_organization_context': {
        const [orgDetails, primaryContact] = await Promise.all([
          fetchOrganizationDetails(orgId),
          fetchOrgPrimaryContact(orgId),
        ]);
        const parts = [orgDetails, primaryContact].filter(Boolean);
        content = parts.length ? parts.join('\n\n') : 'No organization context available.';
        break;
      }

      default:
        content = `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    result = 'failure';
    errorMessage = (err as Error)?.message ?? 'Unknown error';
    content = `Error executing tool "${toolName}": ${errorMessage}`;
    console.error(`Answer tool "${toolName}" failed:`, errorMessage);
  }

  const durationMs = Date.now() - start;
  console.log(`Answer tool "${toolName}" executed: ${content.length} chars, ${durationMs}ms`);

  // Non-blocking audit log
  logToolUsage({
    orgId,
    resourceId: questionId,
    toolName,
    toolInput,
    resultLength: content.length,
    resultEmpty: content.length === 0,
    durationMs,
    result,
    errorMessage,
  }).catch(err => console.warn('Failed to write answer tool audit log:', (err as Error)?.message));

  return { tool_use_id: toolUseId, content };
};
