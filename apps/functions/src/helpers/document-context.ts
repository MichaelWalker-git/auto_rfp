import {
  getExecutiveBriefByProjectId,
  queryCompanyKnowledgeBase,
  truncateText,
} from './executive-opportunity-brief';
import { loadTextFromS3 } from './s3';
import { searchPastProjects, listPastProjects } from './past-performance';
import { getEmbedding, semanticSearchContentLibrary } from './embeddings';
import { requireEnv } from './env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

// ─── Token / char budget constants ───────────────────────────────────────────

/**
 * Maximum characters to use as an embedding search query.
 *
 * Titan Text Embeddings V2 has an 8192-token limit (~32,768 chars at 4 chars/token).
 * We use a conservative 15,000-char cap so the query stays well within the token
 * budget even for dense technical text (which tokenizes at a higher rate).
 *
 * Strategy: take the FIRST portion of the solicitation, which typically contains
 * the most signal-rich content (title, scope, requirements overview, NAICS, etc.)
 * rather than boilerplate terms and conditions at the end.
 */
const MAX_SEARCH_QUERY_CHARS = 15_000;

/**
 * Hard total budget for the combined enrichment context string passed to the
 * generation model.  Claude 3 Sonnet/Haiku have a 200k-token context window,
 * but we keep the enrichment context lean so the model focuses on the
 * solicitation text and Q&A pairs rather than drowning in raw KB chunks.
 *
 * Budget breakdown (chars):
 *   Executive Brief  →  8,000  (structured, already compressed)
 *   Knowledge Base   →  8,000  (top relevant chunks only)
 *   Past Performance →  6,000  (top 3 projects, compressed)
 *   Content Library  →  4,000  (top snippets only)
 *   ─────────────────────────
 *   Total            → 26,000  (~6,500 tokens)
 */
const TOTAL_CONTEXT_BUDGET = 26_000;

/** Minimum relevance score (cosine similarity, 0–1) to include a KB chunk. */
const KB_MIN_SCORE = 0.45;

/** Minimum relevance score to include a past-performance project. */
const PAST_PERF_MIN_SCORE = 0.40;

/** Minimum relevance score to include a content-library snippet. */
const CONTENT_LIB_MIN_SCORE = 0.40;

// ─── Per-section char budgets (must sum to ≤ TOTAL_CONTEXT_BUDGET) ───────────

interface SectionBudgets {
  execBrief: number;
  kb: number;
  pastPerf: number;
  contentLib: number;
}

/**
 * Default balanced allocation.
 * Document-type overrides shift budget toward the most relevant sources.
 */
const DEFAULT_BUDGETS: SectionBudgets = {
  execBrief: 8_000,
  kb: 8_000,
  pastPerf: 6_000,
  contentLib: 4_000,
};

/**
 * Document-type-specific budget overrides.
 *
 * - PAST_PERFORMANCE: maximise past-perf context, reduce content library
 * - TEAM_QUALIFICATIONS: maximise KB (personnel/certs), reduce content library
 * - TECHNICAL_PROPOSAL / MANAGEMENT_PROPOSAL: balanced but more KB
 * - EXECUTIVE_SUMMARY: more exec brief (pre-analysed intel), less content lib
 * - COST_PROPOSAL / PRICE_VOLUME: exec brief for value/CLIN data, less past-perf
 */
const DOC_TYPE_BUDGETS: Record<string, SectionBudgets> = {
  PAST_PERFORMANCE: { execBrief: 6_000, kb: 4_000, pastPerf: 12_000, contentLib: 4_000 },
  TEAM_QUALIFICATIONS: { execBrief: 6_000, kb: 12_000, pastPerf: 4_000, contentLib: 4_000 },
  TECHNICAL_PROPOSAL: { execBrief: 7_000, kb: 10_000, pastPerf: 6_000, contentLib: 3_000 },
  MANAGEMENT_PROPOSAL: { execBrief: 7_000, kb: 10_000, pastPerf: 6_000, contentLib: 3_000 },
  MANAGEMENT_APPROACH: { execBrief: 7_000, kb: 10_000, pastPerf: 6_000, contentLib: 3_000 },
  EXECUTIVE_SUMMARY: { execBrief: 10_000, kb: 6_000, pastPerf: 6_000, contentLib: 4_000 },
  UNDERSTANDING_OF_REQUIREMENTS: { execBrief: 10_000, kb: 8_000, pastPerf: 4_000, contentLib: 4_000 },
  RISK_MANAGEMENT: { execBrief: 10_000, kb: 6_000, pastPerf: 6_000, contentLib: 4_000 },
  COST_PROPOSAL: { execBrief: 10_000, kb: 8_000, pastPerf: 4_000, contentLib: 4_000 },
  PRICE_VOLUME: { execBrief: 10_000, kb: 8_000, pastPerf: 4_000, contentLib: 4_000 },
  COMPLIANCE_MATRIX: { execBrief: 10_000, kb: 6_000, pastPerf: 4_000, contentLib: 6_000 },
};

// ─── Fetch limits (how many candidates to retrieve before score-filtering) ───

const LIMITS = {
  kbTopK: 12,       // fetch 12, keep those above KB_MIN_SCORE (typically 5–8)
  pastPerfTopK: 5,  // fetch 5, keep those above PAST_PERF_MIN_SCORE (typically 2–3)
  contentLibTopK: 10, // fetch 10, keep those above CONTENT_LIB_MIN_SCORE (typically 4–6)
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pushIf(parts: string[], value: unknown, prefix?: string) {
  if (value) parts.push(prefix ? `${prefix}: ${value}` : String(value));
}

function formatSectionData(
  sections: Record<string, unknown>,
  key: string,
  formatter: (data: unknown, parts: string[]) => void,
): string[] {
  const wrap = sections[key] as { status?: string; data?: unknown } | undefined;
  if (wrap?.status !== 'COMPLETE' || !wrap?.data) return [];
  const parts: string[] = [];
  formatter(wrap.data, parts);
  return parts;
}

/**
 * Build a focused, token-safe search query from a solicitation text.
 *
 * Long solicitations (up to 80,000 chars) far exceed the embedding model's
 * token limit. This function extracts the most semantically rich portion —
 * the beginning of the document — which contains the scope, requirements,
 * and evaluation criteria that best represent what we need to search for.
 */
function buildSearchQuery(solicitation: string): string {
  if (!solicitation?.trim()) return '';
  return solicitation.slice(0, MAX_SEARCH_QUERY_CHARS).trim();
}

/**
 * Compress a raw chunk of text to its most informative sentences.
 *
 * Strategy:
 * 1. Split into sentences.
 * 2. Drop sentences that are pure boilerplate (very short, all-caps headers,
 *    page numbers, repeated whitespace, etc.).
 * 3. Truncate to maxChars.
 *
 * This is a lightweight heuristic — no LLM call needed.
 */
function compressChunk(text: string, maxChars: number): string {
  if (!text?.trim()) return '';

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (s.length < 20) return false;                    // too short to be useful
      if (/^\d+$/.test(s)) return false;                  // page numbers
      if (/^[A-Z\s\-_]{10,}$/.test(s)) return false;     // all-caps headers
      if (/^(page|section|table|figure)\s+\d/i.test(s)) return false; // nav text
      return true;
    });

  let result = '';
  for (const sentence of sentences) {
    if (result.length + sentence.length + 1 > maxChars) break;
    result += (result ? ' ' : '') + sentence;
  }

  // Fallback: if sentence splitting produced nothing, just hard-truncate
  return result || text.slice(0, maxChars);
}

/**
 * Load S3 chunks for Pinecone matches, applying score filtering and per-chunk
 * compression.  Returns only chunks that pass the minimum score threshold.
 */
async function loadAndCompressChunks(
  matches: Array<{ score?: number; source?: { chunkKey?: string; documentId?: string } }>,
  topK: number,
  minScore: number,
  maxCharsPerChunk: number,
): Promise<string[]> {
  // Filter by relevance score first — avoid loading S3 objects for low-quality matches
  const relevant = matches
    .slice(0, topK)
    .filter((m) => (m.score ?? 0) >= minScore);

  if (!relevant.length) return [];

  const loaded = await Promise.all(
    relevant.map(async (m, i) => {
      const rawText = m.source?.chunkKey
        ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey).catch(() => '')
        : '';
      const compressed = compressChunk(rawText, maxCharsPerChunk);
      if (!compressed) return null;
      const scoreLabel = m.score !== undefined ? ` [score=${m.score.toFixed(2)}]` : '';
      return `[${i + 1}]${scoreLabel}\n${compressed}`;
    }),
  );

  return loaded.filter((c): c is string => c !== null);
}

// ─── Context Loaders ─────────────────────────────────────────────────────────

export async function loadExecutiveBriefContext(
  projectId: string,
  opportunityId?: string,
  charBudget = DEFAULT_BUDGETS.execBrief,
): Promise<string> {
  try {
    const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);
    const sections = brief?.sections as Record<string, unknown> | undefined;
    if (!sections) return '';

    const parts: string[] = [];

    // Summary — always include (most signal-dense section)
    parts.push(...formatSectionData(sections, 'summary', (s, p) => {
      const data = s as Record<string, unknown>;
      p.push('=== OPPORTUNITY SUMMARY ===');
      for (const [k, label] of [
        ['title', 'Title'], ['agency', 'Agency'], ['office', 'Office'],
        ['solicitationNumber', 'Sol#'], ['naics', 'NAICS'],
        ['contractType', 'Type'], ['setAside', 'Set-Aside'],
        ['placeOfPerformance', 'PoP'], ['estimatedValueUsd', 'Value'],
        ['summary', 'Scope'],
      ] as const) {
        pushIf(p, data[k], label);
      }
    }));

    // Requirements — top must-haves only (most relevant for generation)
    parts.push(...formatSectionData(sections, 'requirements', (r, p) => {
      const data = r as {
        overview?: string;
        requirements?: Array<{ mustHave?: boolean; requirement?: string }>;
        deliverables?: string[];
        evaluationFactors?: string[];
      };
      p.push('\n=== KEY REQUIREMENTS ===');
      pushIf(p, data.overview, 'Overview');
      const mustHaves = (data.requirements ?? []).filter((req) => req.mustHave).slice(0, 10);
      mustHaves.forEach((req, i) => p.push(`  ${i + 1}. ${req.requirement}`));
      if (data.evaluationFactors?.length) {
        p.push('Eval Factors: ' + data.evaluationFactors.slice(0, 8).join(' | '));
      }
      if (data.deliverables?.length) {
        p.push('Deliverables: ' + data.deliverables.slice(0, 6).join(', '));
      }
    }));

    // Risks — red flags + top risks only
    parts.push(...formatSectionData(sections, 'risks', (rk, p) => {
      const data = rk as {
        redFlags?: Array<{ severity?: string; flag?: string; mitigation?: string }>;
        risks?: Array<{ severity?: string; flag?: string; mitigation?: string }>;
        incumbentInfo?: { knownIncumbent?: boolean; incumbentName?: string };
      };
      const highRisks = [...(data.redFlags ?? []), ...(data.risks ?? [])]
        .filter((f) => ['HIGH', 'CRITICAL'].includes(f.severity ?? ''))
        .slice(0, 4);
      if (!highRisks.length && !data.incumbentInfo?.knownIncumbent) return;
      p.push('\n=== KEY RISKS ===');
      highRisks.forEach((f) => {
        p.push(`  [${f.severity}] ${f.flag}${f.mitigation ? ` → ${f.mitigation}` : ''}`);
      });
      if (data.incumbentInfo?.knownIncumbent) {
        p.push(`  Incumbent: ${data.incumbentInfo.incumbentName || 'Known'}`);
      }
    }));

    // Contacts — compact one-liner per contact
    parts.push(...formatSectionData(sections, 'contacts', (c, p) => {
      const data = c as {
        contacts?: Array<{ role?: string; name?: string; title?: string; email?: string }>;
      };
      const contacts = (data.contacts ?? []).slice(0, 4);
      if (!contacts.length) return;
      p.push('\n=== CONTACTS ===');
      contacts.forEach((ct) => {
        p.push(`  ${[ct.role, ct.name, ct.email].filter(Boolean).join(' | ')}`);
      });
    }));

    // Deadlines — submission deadline only (most critical)
    parts.push(...formatSectionData(sections, 'deadlines', (d, p) => {
      const data = d as {
        submissionDeadlineIso?: string;
        deadlines?: Array<{ type?: string; label?: string; dateTimeIso?: string; rawText?: string }>;
      };
      if (!data.submissionDeadlineIso && !data.deadlines?.length) return;
      p.push('\n=== DEADLINES ===');
      if (data.submissionDeadlineIso) p.push(`  Submission: ${data.submissionDeadlineIso}`);
      (data.deadlines ?? [])
        .filter((dl) => dl.type !== 'PROPOSAL_DUE')
        .slice(0, 3)
        .forEach((dl) => p.push(`  ${dl.type}: ${dl.dateTimeIso || dl.rawText || 'TBD'}`));
    }));

    // Scoring — decision + composite score only (skip per-criterion detail)
    parts.push(...formatSectionData(sections, 'scoring', (sc, p) => {
      const data = sc as {
        decision?: string;
        compositeScore?: number;
        summaryJustification?: string;
      };
      if (!data.decision) return;
      p.push('\n=== BID DECISION ===');
      pushIf(p, data.decision, 'Decision');
      if (data.compositeScore) p.push(`Score: ${data.compositeScore}/5`);
      if (data.summaryJustification) {
        p.push(`Rationale: ${truncateText(data.summaryJustification, 300)}`);
      }
    }));

    // Past performance from brief — top 3 matches only
    parts.push(...formatSectionData(sections, 'pastPerformance', (pp, p) => {
      const data = pp as {
        matches?: Array<{
          relevanceScore?: number;
          project?: { title?: string; client?: string; description?: string };
        }>;
        gapAnalysis?: { overallCoverage?: number; criticalGaps?: string[] };
      };
      const topMatches = (data.matches ?? [])
        .filter((m) => (m.relevanceScore ?? 0) >= 50)
        .slice(0, 3);
      if (!topMatches.length) return;
      p.push('\n=== RELEVANT PAST PERFORMANCE ===');
      topMatches.forEach((m) => {
        const proj = m.project;
        if (!proj) return;
        const desc = proj.description ? truncateText(proj.description, 150) : '';
        p.push(`  • ${proj.title || 'Project'} (${m.relevanceScore}% match)${proj.client ? ` — ${proj.client}` : ''}${desc ? `: ${desc}` : ''}`);
      });
      if (data.gapAnalysis?.criticalGaps?.length) {
        p.push(`  Gaps: ${data.gapAnalysis.criticalGaps.slice(0, 3).join(', ')}`);
      }
    }));

    const combined = parts.join('\n').trim();
    const result = truncateText(combined, charBudget);
    console.log(`execBrief context: ${combined.length} → ${result.length} chars (budget=${charBudget})`);
    return result;
  } catch (err) {
    console.log('No executive brief found:', (err as Error)?.message);
    return '';
  }
}

export async function loadKnowledgeBaseContext(
  orgId: string,
  solicitation: string,
  charBudget = DEFAULT_BUDGETS.kb,
): Promise<string> {
  try {
    const searchQuery = buildSearchQuery(solicitation);
    if (!searchQuery) return '';

    const matches = await queryCompanyKnowledgeBase(orgId, searchQuery, LIMITS.kbTopK);
    if (!matches?.length) return '';

    // Allocate chars evenly across chunks that pass the score threshold
    const maxCharsPerChunk = Math.floor(charBudget / Math.max(matches.length, 1));
    const chunks = await loadAndCompressChunks(
      matches,
      LIMITS.kbTopK,
      KB_MIN_SCORE,
      Math.max(maxCharsPerChunk, 400), // at least 400 chars per chunk
    );

    if (!chunks.length) return '';
    const result = truncateText(chunks.join('\n\n'), charBudget);
    console.log(`KB context: ${chunks.length} chunks → ${result.length} chars (budget=${charBudget})`);
    return result;
  } catch (err) {
    console.warn('Failed to load KB context:', (err as Error)?.message);
    return '';
  }
}

export async function loadPastPerformanceContext(
  orgId: string,
  solicitation: string,
  charBudget = DEFAULT_BUDGETS.pastPerf,
): Promise<string> {
  try {
    const searchQuery = buildSearchQuery(solicitation);
    if (!searchQuery) return '';

    const results = await searchPastProjects(orgId, searchQuery, LIMITS.pastPerfTopK);

    // Filter by relevance score; fall back to listing all projects if no semantic results
    const relevant = results?.filter((r) => (r.score ?? 0) >= PAST_PERF_MIN_SCORE) ?? [];

    const projects: string[] = relevant.length
      ? relevant.map((r, i) => {
          const lines: string[] = [
            `[${i + 1}] ${r.metadata?.title || 'Project'} (score=${r.score?.toFixed(2)})`,
          ];
          pushIf(lines, r.metadata?.client, '  Client');
          pushIf(lines, r.metadata?.domain, '  Domain');
          if (r.metadata?.technologies?.length) {
            lines.push(`  Tech: ${(r.metadata.technologies as string[]).slice(0, 5).join(', ')}`);
          }
          return lines.join('\n');
        })
      : await (async () => {
          const { items } = await listPastProjects(orgId, false, LIMITS.pastPerfTopK);
          return items.map((p, i) => {
            const lines: string[] = [`[${i + 1}] ${p.title}`];
            pushIf(lines, p.client, '  Client');
            if (p.description) lines.push(`  ${truncateText(p.description, 200)}`);
            if (p.technologies?.length) lines.push(`  Tech: ${p.technologies.slice(0, 5).join(', ')}`);
            if (p.achievements?.length) lines.push(`  Results: ${p.achievements.slice(0, 2).join('; ')}`);
            if (p.value) lines.push(`  Value: $${p.value}`);
            if (p.performanceRating) lines.push(`  Rating: ${p.performanceRating}/5`);
            return lines.join('\n');
          });
        })();

    if (!projects.length) return '';
    const result = truncateText(projects.join('\n\n'), charBudget);
    console.log(`pastPerf context: ${projects.length} projects → ${result.length} chars (budget=${charBudget})`);
    return result;
  } catch (err) {
    console.warn('Failed to load past performance context:', (err as Error)?.message);
    return '';
  }
}

export async function loadContentLibraryContext(
  orgId: string,
  solicitation: string,
  charBudget = DEFAULT_BUDGETS.contentLib,
): Promise<string> {
  try {
    const searchQuery = buildSearchQuery(solicitation);
    if (!searchQuery) return '';

    const embedding = await getEmbedding(searchQuery);
    const hits = await semanticSearchContentLibrary(orgId, embedding, LIMITS.contentLibTopK);
    if (!hits?.length) return '';

    const maxCharsPerChunk = Math.floor(charBudget / Math.max(hits.length, 1));
    const chunks = await loadAndCompressChunks(
      hits,
      LIMITS.contentLibTopK,
      CONTENT_LIB_MIN_SCORE,
      Math.max(maxCharsPerChunk, 300),
    );

    if (!chunks.length) return '';
    const result = truncateText(chunks.join('\n\n'), charBudget);
    console.log(`contentLib context: ${chunks.length} snippets → ${result.length} chars (budget=${charBudget})`);
    return result;
  } catch (err) {
    console.warn('Failed to load content library context:', (err as Error)?.message);
    return '';
  }
}

/**
 * Gather all context sources in parallel, applying document-type-aware budget
 * allocation and relevance filtering.
 *
 * Budget allocation strategy:
 * - Each document type has a pre-defined budget split (see DOC_TYPE_BUDGETS).
 * - Within each section, only chunks above the minimum relevance score are kept.
 * - Each chunk is compressed to remove boilerplate before being included.
 * - The total combined context is capped at TOTAL_CONTEXT_BUDGET chars.
 *
 * This ensures the generation model receives a focused, high-signal context
 * rather than a large dump of loosely related text.
 */
export async function gatherAllContext(args: {
  projectId: string;
  orgId: string;
  opportunityId?: string;
  solicitation: string;
  documentType?: string;
}): Promise<string> {
  const { projectId, orgId, opportunityId, solicitation, documentType } = args;

  const budgets: SectionBudgets = documentType
    ? (DOC_TYPE_BUDGETS[documentType] ?? DEFAULT_BUDGETS)
    : DEFAULT_BUDGETS;

  console.log(
    `Gathering context: projectId=${projectId}, orgId=${orgId}, ` +
    `opportunityId=${opportunityId || 'none'}, documentType=${documentType || 'default'}, ` +
    `budgets=${JSON.stringify(budgets)}`,
  );

  const [execBrief, kb, pastPerf, contentLib] = await Promise.all([
    loadExecutiveBriefContext(projectId, opportunityId, budgets.execBrief),
    loadKnowledgeBaseContext(orgId, solicitation, budgets.kb),
    loadPastPerformanceContext(orgId, solicitation, budgets.pastPerf),
    loadContentLibraryContext(orgId, solicitation, budgets.contentLib),
  ]);

  const totalRaw = execBrief.length + kb.length + pastPerf.length + contentLib.length;
  console.log(
    `Context gathered: execBrief=${execBrief.length}, kb=${kb.length}, ` +
    `pastPerf=${pastPerf.length}, contentLib=${contentLib.length} chars ` +
    `(total=${totalRaw}, budget=${TOTAL_CONTEXT_BUDGET})`,
  );

  const sections: [string, string, string][] = [
    [
      'EXECUTIVE OPPORTUNITY BRIEF',
      'Pre-analyzed opportunity intelligence. Use to align with evaluation criteria and address risks.',
      execBrief,
    ],
    [
      'COMPANY KNOWLEDGE BASE',
      'Relevant company capabilities, processes, and personnel. Use to demonstrate specific expertise.',
      kb,
    ],
    [
      'PAST PERFORMANCE',
      'Relevant past contracts. Reference to prove track record and relevant experience.',
      pastPerf,
    ],
    [
      'CONTENT LIBRARY',
      'Pre-approved messaging snippets. Use for consistent, vetted language.',
      contentLib,
    ],
  ];

  const combined = sections
    .filter(([, , text]) => text.trim())
    .map(([title, desc, text]) => `--- ${title} ---\n(${desc})\n${text}`)
    .join('\n\n');

  // Final safety cap — should rarely trigger given per-section budgets
  return truncateText(combined, TOTAL_CONTEXT_BUDGET);
}
