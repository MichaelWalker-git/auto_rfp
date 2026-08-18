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
import { getPastProject } from '@/helpers/past-performance';
import { isUsableInMatching, redactForGeneration, anonymizationNotice } from '@/helpers/past-performance-disclosure';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── Retrieval thresholds (calibrated for Titan Text Embeddings V2) ─────────────
//
// Titan V2 is a SYMMETRIC embedding model — it has no separate query/passage
// modes. A short interrogative RFP question ("Describe your transition
// services…") and a declarative KB passage embed quite differently, so
// genuinely-relevant question→chunk cosine scores land in roughly the 0.20–0.45
// band, NOT the 0.6–0.8 range typical of asymmetric query/passage models.
//
// Measured on production dev data (org namespace, June 2026): the most relevant
// KB chunks for real questions topped out at ~0.32, and even near-verbatim
// same-document solicitation matches peaked at ~0.46. The previous 0.50 floor
// therefore discarded ~99.5% of KB results (611 of 614 searches returned the
// empty-result string), leaving most questions with no company-specific
// evidence and an empty answer. For comparison, the content-library tool floor
// is 0.15 (see db-tool-helpers.ts) — which is why content-library matches
// surface while KB matches did not, for the very same questions.
//
// RETRIEVAL_MIN_SCORE sits above the noise band (~0.12) but below where this
// corpus's relevant matches cluster (0.20–0.31), to recover real matches while
// filtering clearly-unrelated chunks. Verified on this project's questions:
// 0.50→0% recovered, 0.30→25%, 0.25→~50%, 0.20→85%. Set to 0.25 as the
// recall/precision balance — weak matches still surface but are flagged
// low-confidence (see RETRIEVAL_WEAK_SCORE), and questions with no usable
// evidence fall through to the "answer manually" KB notice in the UI. Tune
// here if recall (too many blanks) or precision (tangential noise) needs work.
const RETRIEVAL_MIN_SCORE = 0.25;

// Matches above the floor but below this value are weak/tangential. We KEEP them
// (partial, cited evidence beats a blank answer — see the ANSWER system prompt's
// "PARTIAL IS BETTER THAN BLANK" rule) but flag them so the model lowers its
// confidence rather than discarding them.
const RETRIEVAL_WEAK_SCORE = 0.45;

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

    // Log the actual score distribution so retrieval recall is diagnosable from
    // CloudWatch alone (no Pinecone replay needed) when answers come back empty.
    const topScores = hits.slice(0, 5).map(h => (h.score ?? 0).toFixed(3)).join(', ');
    console.log(`[answer-tools] KB search "${query.slice(0, 60)}" — ${hits.length} hits, top scores: [${topScores}], floor=${RETRIEVAL_MIN_SCORE}`);

    const relevant = hits.filter(h => (h.score ?? 0) >= RETRIEVAL_MIN_SCORE).slice(0, topK);
    if (!relevant.length) return emptySearchResult(`No sufficiently relevant knowledge base content found (all scores below ${RETRIEVAL_MIN_SCORE}).`);

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
          // Clamp relevance to 0-1 range (Pinecone scores can vary)
          relevance: h.score != null ? Math.max(0, Math.min(1, h.score)) : undefined,
          textContent: truncatedText,
        });

        return `[KB ${i + 1}] (score: ${h.score?.toFixed(2)})${docName ? ` — ${docName}` : ''}\n${truncatedText}`;
      }),
    );

    const valid = chunks.filter((c): c is string => c !== null);
    if (!valid.length) return emptySearchResult('Could not load knowledge base content.');

    // Flag weak/tangential matches so the model LOWERS its confidence — but does
    // NOT discard them. Telling the model to "return the empty answer JSON" here
    // (the previous behavior) contradicted the system prompt's PARTIAL-IS-BETTER
    // rule and blanked out every match in the legitimate 0.30–0.45 band, which is
    // exactly where Titan V2 question→chunk matches land for this corpus.
    const maxKbScore = Math.max(...similarityScores);
    const avgKbScore = similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length;
    const lowScoreWarning = maxKbScore < RETRIEVAL_WEAK_SCORE
      ? `⚠️ LOW RELEVANCE: similarity scores are modest (avg: ${avgKbScore.toFixed(2)}, max: ${maxKbScore.toFixed(2)}). These excerpts may only partially relate to the question. Use whatever is genuinely relevant, cite it, and set a LOW confidence (0.10–0.29). Do NOT fabricate beyond these excerpts, but do NOT return an empty answer if any excerpt is usable.\n\n`
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

    const topScores = hits.slice(0, 5).map(h => (h.score ?? 0).toFixed(3)).join(', ');
    console.log(`[answer-tools] PP search "${keywords.slice(0, 60)}" — ${hits.length} hits, top scores: [${topScores}], floor=${RETRIEVAL_MIN_SCORE}`);

    const relevant = hits.filter(h => (h.score ?? 0) >= RETRIEVAL_MIN_SCORE).slice(0, topK);
    if (!relevant.length) return emptySearchResult(`No sufficiently relevant past performance found (all scores below ${RETRIEVAL_MIN_SCORE}).`);

    // Disclosure gate: this feeds an LLM, so we must NOT trust Pinecone metadata
    // for the client name (it may be stale / NDA-gated). Re-read the authoritative
    // DynamoDB record per hit, drop DO_NOT_USE, and redact non-NAMEABLE (mirrors
    // document-context surface #5). Each task returns a self-contained result (or
    // null); we assemble the output arrays from the ordered, filtered list AFTER
    // the concurrent map, so ordering is stable and [PP n] numbering has no gaps.
    interface PpEntry {
      score: number;
      sk?: string;
      title: string;
      body: string; // formatted lines minus the [PP n] header
      createdDate?: string;
    }

    const entriesNullable = await Promise.all(
      relevant.map(async (h): Promise<PpEntry | null> => {
        const m = h.source as Record<string, unknown>;
        const projectId = m.projectId as string | undefined;
        const loaded = projectId ? await getPastProject(orgId, projectId).catch(() => null) : null;
        if (!loaded || !isUsableInMatching(loaded)) return null;
        const project = redactForGeneration(loaded);

        const lines: string[] = [];
        lines.push(`Project: ${project.title}`);
        lines.push(`Client: ${project.client}`);
        const notice = anonymizationNotice(loaded);
        if (notice) lines.push(notice);
        if (project.domain) lines.push(`Domain: ${project.domain}`);
        if (project.value) lines.push(`Value: $${project.value}`);
        if (project.description) lines.push(`Description: ${truncateText(project.description, 300)}`);
        if (project.technologies?.length) {
          lines.push(`Technologies: ${project.technologies.slice(0, 6).join(', ')}`);
        }
        if (project.achievements?.length) {
          lines.push('Achievements:');
          project.achievements.slice(0, 3).forEach(a => lines.push(`  • ${a}`));
        }

        return {
          score: h.score ?? 0,
          sk: m[SK_NAME] as string | undefined,
          title: project.title,
          body: lines.join('\n'),
          createdDate: (project.createdAt ?? project.updatedAt) as string | undefined,
        };
      }),
    );

    // Order-stable: same order as `relevant`, gate-dropped entries removed.
    const entries = entriesNullable.filter((e): e is PpEntry => e !== null);
    if (!entries.length) {
      return emptySearchResult('No usable past performance projects found (disclosure-gated).');
    }

    // Number sequentially over the surviving entries so there are no [PP 1],[PP 3] gaps.
    const formatted = entries.map((e, i) => `[PP ${i + 1}] (score: ${e.score.toFixed(2)})\n${e.body}`);
    const similarityScores = entries.map((e) => e.score);
    const sources: ToolResultSource[] = entries.map((e, i) => ({
      id: e.sk ?? `pp-${i}`,
      fileName: `Past Performance: ${e.title}`,
      // Clamp relevance to 0-1 range (Pinecone scores can vary)
      relevance: Math.max(0, Math.min(1, e.score)),
      textContent: formatted[i],
    }));
    const sourceCreatedDates = entries
      .map((e) => e.createdDate)
      .filter((d): d is string => !!d);

    // Flag weak matches to lower confidence — but keep them. (See the KB-search
    // rationale above: discarding the 0.30–0.45 band is what blanked answers.)
    const maxPpScore = Math.max(...similarityScores);
    const avgPpScore = similarityScores.reduce((a, b) => a + b, 0) / similarityScores.length;
    const lowPpWarning = maxPpScore < RETRIEVAL_WEAK_SCORE
      ? `⚠️ LOW RELEVANCE: similarity scores are modest (avg: ${avgPpScore.toFixed(2)}, max: ${maxPpScore.toFixed(2)}). These projects may be in a different domain than the question — experience in domain X does NOT prove capability in domain Y. Cite only genuinely relevant projects, acknowledge gaps, and set a LOW confidence (0.10–0.29). Do NOT return an empty answer if any project is usable.\n\n`
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
