/**
 * Claude Tool Use definitions and executors for answer generation.
 *
 * These tools allow Claude to actively query the database during answer
 * generation rather than relying solely on pre-fetched context.
 *
 * Available tools (5 total):
 *  - search_knowledge_base    → semantic search over company KB chunks
 *  - search_past_performance  → semantic search over past projects
 *  - get_content_library      → search pre-approved Q&A pairs
 *  - get_organization_context → org details, primary contact, team
 *  - get_solicitation_text    → load the original solicitation/RFP document text
 */

import { getEmbedding } from '@/helpers/embeddings';
import { semanticSearchChunks, semanticSearchPastPerformance } from '@/helpers/semantic-search';
import { loadTextFromS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import { truncateText, loadAllSolicitationTexts } from '@/helpers/executive-opportunity-brief';
import {
  fetchOrganizationDetails,
  fetchOrgPrimaryContact,
  fetchContentLibraryMatches,
  logToolUsage,
} from '@/helpers/db-tool-helpers';
import type { ToolResult, ToolResultSource } from '@/types/tool';
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
  {
    name: 'get_solicitation_text',
    description:
      'Load the original solicitation/RFP document text for this project. ' +
      'Use this when the question references specific solicitation requirements, ' +
      'Section L/M criteria, submission instructions, deadlines, evaluation factors, ' +
      'contract terms, or any details that would be found in the original RFP documents. ' +
      'This returns the full text of the uploaded solicitation documents.',
    input_schema: {
      type: 'object' as const,
      properties: {
        max_chars: {
          type: 'number',
          description: 'Maximum characters to return (default: 30000). Use a smaller value if you only need a quick reference.',
        },
      },
      required: [],
    },
  },
] as const;

export type AnswerToolName = typeof ANSWER_TOOLS[number]['name'];

// ─── Tool executors ───────────────────────────────────────────────────────────

interface ToolSearchResult {
  content: string;
  similarityScores: number[];
  sources: ToolResultSource[];
  sourceCreatedDates: string[];
}

const emptySearchResult = (content: string): ToolSearchResult => ({
  content,
  similarityScores: [],
  sources: [],
  sourceCreatedDates: [],
});

const executeKbSearch = async (
  orgId: string,
  query: string,
  limit = 5,
): Promise<ToolSearchResult> => {
  const topK = Math.min(Math.max(limit, 1), 10);
  try {
    const embedding = await getEmbedding(query);
    const hits = await semanticSearchChunks(orgId, embedding, topK * 2);
    if (!hits.length) return emptySearchResult('No knowledge base content found for that query.');

    const relevant = hits.filter(h => (h.score ?? 0) >= 0.50).slice(0, topK);
    if (!relevant.length) return emptySearchResult('No sufficiently relevant knowledge base content found (all scores below 0.50).');

    const similarityScores = relevant.map(h => h.score ?? 0);
    const sources: ToolResultSource[] = [];
    const sourceCreatedDates: string[] = [];

    const chunks = await Promise.all(
      relevant.map(async (h, i) => {
        const chunkKey = h.source?.chunkKey;
        const text = chunkKey
          ? await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey).catch(() => '')
          : '';
        if (!text.trim()) return null;

        // Get document name and dates from DynamoDB
        const pk = h.source?.[PK_NAME];
        const sk = h.source?.[SK_NAME];
        let docName = '';
        if (pk && sk) {
          const docItem = await getItem<Record<string, unknown>>(pk, sk).catch(() => null);
          docName = docItem?.name as string ?? '';
          const dateStr = (docItem?.updatedAt ?? docItem?.createdAt) as string | undefined;
          if (dateStr) sourceCreatedDates.push(dateStr);
        }

        // Extract kbId and documentId from Pinecone metadata or sort key
        // Sort key format: KB#{kbId}#DOC#{docId}
        const kbId = h.source?.kbId as string | undefined;
        const skParts = sk ? String(sk).split('#') : [];
        const documentId = (h.source?.documentId as string | undefined)
          ?? (skParts.length >= 4 ? skParts[3] : undefined);

        const truncatedText = truncateText(text, 600);

        sources.push({
          id: `kb-${i}`,
          documentId,
          kbId,
          chunkKey,
          fileName: docName || undefined,
          relevance: h.score ?? undefined,
          textContent: truncatedText,
        });

        return `[KB ${i + 1}] (score: ${h.score?.toFixed(2)})${docName ? ` — ${docName}` : ''}\n${truncatedText}`;
      }),
    );

    const valid = chunks.filter((c): c is string => c !== null);
    if (!valid.length) return emptySearchResult('Could not load knowledge base content.');

    // Add warning when all scores are below 0.65 — signals weak/tangential matches
    const maxKbScore = Math.max(...similarityScores);
    const avgKbScore = similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length;
    const lowScoreWarning = maxKbScore < 0.65
      ? `⚠️ LOW RELEVANCE WARNING: All similarity scores are below 0.65 (avg: ${avgKbScore.toFixed(2)}, max: ${maxKbScore.toFixed(2)}). These excerpts may be about a DIFFERENT topic than the question. If so, treat this as NO relevant information and return the empty answer JSON.\n\n`
      : '';

    return {
      content: `${lowScoreWarning}Found ${valid.length} relevant KB excerpt(s):\n\n${valid.join('\n\n---\n\n')}`,
      similarityScores,
      sources,
      sourceCreatedDates,
    };
  } catch (err) {
    console.warn('search_knowledge_base (answer) error:', (err as Error)?.message);
    return emptySearchResult(`Error searching knowledge base: ${(err as Error)?.message}`);
  }
};

const executePastPerfSearch = async (
  orgId: string,
  keywords: string,
  limit = 3,
): Promise<ToolSearchResult> => {
  const topK = Math.min(Math.max(limit, 1), 5);
  try {
    const embedding = await getEmbedding(keywords);
    const hits = await semanticSearchPastPerformance(orgId, embedding, topK * 2);
    if (!hits.length) return emptySearchResult('No past performance projects found matching those keywords.');

    const relevant = hits.filter(h => (h.score ?? 0) >= 0.50).slice(0, topK);
    if (!relevant.length) return emptySearchResult('No sufficiently relevant past performance found (all scores below 0.50).');

    const similarityScores = relevant.map(h => h.score ?? 0);
    const sources: ToolResultSource[] = [];
    const sourceCreatedDates: string[] = [];

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

      // Build source metadata
      const sk = m[SK_NAME] as string | undefined;
      const formattedText = lines.join('\n');
      sources.push({
        id: sk ?? `pp-${i}`,
        fileName: m.title ? `Past Performance: ${m.title}` : undefined,
        relevance: h.score ?? undefined,
        textContent: formattedText,
      });
      const dateStr = (m.createdAt ?? m.updatedAt) as string | undefined;
      if (dateStr) sourceCreatedDates.push(dateStr);

      return formattedText;
    });

    // Add warning when all scores are below 0.65
    const maxPpScore = Math.max(...similarityScores);
    const avgPpScore = similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length;
    const lowPpWarning = maxPpScore < 0.65
      ? `⚠️ LOW RELEVANCE WARNING: All similarity scores are below 0.65 (avg: ${avgPpScore.toFixed(2)}, max: ${maxPpScore.toFixed(2)}). These projects may be in a DIFFERENT domain than the question asks about. Experience in domain X does NOT prove capability in domain Y. If the projects are not directly relevant, treat this as NO relevant information and return the empty answer JSON.\n\n`
      : '';

    return {
      content: `${lowPpWarning}Found ${formatted.length} relevant past performance project(s):\n\n${formatted.join('\n\n---\n\n')}`,
      similarityScores,
      sources,
      sourceCreatedDates,
    };
  } catch (err) {
    console.warn('search_past_performance (answer) error:', (err as Error)?.message);
    return emptySearchResult(`Error searching past performance: ${(err as Error)?.message}`);
  }
};

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

export const executeAnswerTool = async (args: {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId: string;
  orgId: string;
  questionId: string;
  projectId?: string;
  opportunityId?: string;
}): Promise<ToolResult> => {
  const { toolName, toolInput, toolUseId, orgId, questionId, projectId, opportunityId } = args;

  const start = Date.now();
  let content: string;
  let similarityScores: number[] | undefined;
  let sources: ToolResultSource[] | undefined;
  let sourceCreatedDates: string[] | undefined;
  let result: 'success' | 'failure' = 'success';
  let errorMessage: string | undefined;

  try {
    switch (toolName) {
      case 'search_knowledge_base': {
        const kbResult = await executeKbSearch(
          orgId,
          String(toolInput.query ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 5,
        );
        content = kbResult.content;
        similarityScores = kbResult.similarityScores;
        sources = kbResult.sources;
        sourceCreatedDates = kbResult.sourceCreatedDates;
        break;
      }

      case 'search_past_performance': {
        const ppResult = await executePastPerfSearch(
          orgId,
          String(toolInput.keywords ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        content = ppResult.content;
        similarityScores = ppResult.similarityScores;
        sources = ppResult.sources;
        sourceCreatedDates = ppResult.sourceCreatedDates;
        break;
      }

      case 'get_content_library': {
        const clResult = await fetchContentLibraryMatches(
          orgId,
          String(toolInput.query ?? ''),
          typeof toolInput.limit === 'number' ? toolInput.limit : 3,
        );
        content = clResult.content || 'No content library matches found for that query.';
        similarityScores = clResult.similarityScores;
        if (clResult.sources.length) {
          sources = clResult.sources.map(s => ({
            id: s.id,
            fileName: s.fileName,
            relevance: s.relevance,
            textContent: s.textContent,
          }));
        }
        break;
      }

      case 'get_organization_context': {
        const [orgDetails, primaryContact] = await Promise.all([
          fetchOrganizationDetails(orgId),
          fetchOrgPrimaryContact(orgId),
        ]);
        const parts = [orgDetails, primaryContact].filter(Boolean);
        content = parts.length ? parts.join('\n\n') : 'No organization context available.';
        if (content && content !== 'No organization context available.') {
          sources = [{
            id: `org-${orgId}`,
            fileName: 'Organization Profile',
            textContent: truncateText(content, 600),
          }];
        }
        break;
      }

      case 'get_solicitation_text': {
        if (!projectId) {
          content = 'Cannot load solicitation text: projectId is not available.';
          break;
        }
        const maxChars = typeof toolInput.max_chars === 'number'
          ? Math.min(Math.max(toolInput.max_chars, 1000), 80000)
          : 30000;
        const solText = await loadAllSolicitationTexts(projectId, opportunityId ?? '', maxChars);
        if (!solText.trim()) {
          content = 'No solicitation documents found for this project. The solicitation may not have been uploaded yet.';
        } else {
          content = `Solicitation document text (${solText.length} chars):\n\n${solText}`;
          sources = [{
            id: `solicitation-${projectId}`,
            fileName: 'Solicitation/RFP Documents',
            textContent: truncateText(solText, 600),
          }];
        }
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

  // Tag every source with the tool that produced it
  if (sources?.length) {
    sources = sources.map(s => ({ ...s, toolName }));
  }

  return {
    tool_use_id: toolUseId,
    content,
    ...(similarityScores?.length ? { similarityScores } : {}),
    ...(sources?.length ? { sources } : {}),
    ...(sourceCreatedDates?.length ? { sourceCreatedDates } : {}),
  };
};
