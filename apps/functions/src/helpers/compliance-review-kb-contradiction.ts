/**
 * C3 — Knowledge-base prose-contradiction (full review only).
 *
 * Package prose can assert something the org's APPROVED knowledge base directly
 * contradicts (e.g. the doc says "we do not offer 24/7 support" while an approved
 * KB answer says we do). Runs on HTML RFP documents ONLY — forms have no prose,
 * and questionnaire cells are covered by the deterministic value checks.
 *
 * Package-anchored, SECTION-chunked (D6):
 *   1. Split each HTML doc into sections via extractHeadings + getSectionText —
 *      section-aligned chunking makes the heading a valid anchor and the section
 *      text the snippet source.
 *   2. For each section, retrieve top-K KB hits via `searchKnowledgeBase`, which
 *      hard-gates to APPROVED && !isArchived && ACTIVE in CODE (FR-6). Sections
 *      with no surviving KB hit are skipped.
 *   3. ONE batched model call per document: [{heading, sectionText, kbAnswers[]}]
 *      → only genuine contradictions, each with the verbatim snippet.
 *   4. Build FACTUAL_INACCURACY / major, anchored to the REAL heading (passed
 *      back from code, never trusted from the model) + verbatim snippet.
 *
 * Recall is retrieval-gated (a softer ceiling than the deterministic checks) —
 * accepted (D6), logged via `factual-candidates`. Best-effort → `[]` on failure.
 */
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { loadInventoryDocHtml } from '@/helpers/compliance-review-doc-cache';
import { splitIntoSections } from '@/helpers/compliance-review-html';
import { getLinkedKBIds } from '@/helpers/project-kb';
import { searchKnowledgeBase, type KbHit } from '@/helpers/compliance-truth-sources';
import {
  FACTUAL_KB_TOP_K,
  MAX_FACTUAL_CANDIDATES_PER_CHECK,
  MAX_FACTUAL_SECTION_CHARS,
  MAX_TOKENS_FACTUAL,
} from '@/constants/compliance-review';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';
import { norm } from '@/helpers/compliance-review-text';
import { z } from 'zod';

/** A section BEFORE KB retrieval — cheap to build (HTML parse only). */
interface RawSection {
  documentId: string;
  documentTitle: string;
  heading: string;
  sectionText: string;
}

interface SectionCandidate extends RawSection {
  kbHits: KbHit[];
}

// ─── Stage 2 — model contradiction check (one call per document) ─────────────

const buildContradictionPrompt = (
  documentTitle: string,
  sections: Array<{ i: number; heading: string; sectionText: string; kbAnswers: string[] }>,
) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You detect where a proposal SECTION contradicts the company\'s own approved knowledge-base ' +
    'answers. For each section you are given its heading, its text, and candidate KB answers. Return ' +
    'ONLY genuine factual contradictions — where the section asserts something that directly conflicts ' +
    'with a KB answer (not merely different wording, omission, or additional detail). For each, copy a ' +
    'SHORT VERBATIM excerpt from the section text (do not paraphrase). Return ONLY JSON: ' +
    '{ "contradictions": [{ "index": <i>, "verbatimSnippet": "<exact excerpt>", "why": "<one line>" }, ...] }.',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `DOCUMENT: "${documentTitle}"\n\nSECTIONS:\n` +
            sections
              .map(
                (s) =>
                  `#${s.i} HEADING="${s.heading}"\nSECTION TEXT: ${s.sectionText}\n` +
                  `KB ANSWERS:\n${s.kbAnswers.map((a) => `- ${a}`).join('\n')}`,
              )
              .join('\n\n---\n\n') +
            '\n\nReturn only genuine contradictions with a verbatim snippet. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

// Model payload shape (rule 02 — validate model JSON with Zod). Coercion + `.catch`
// mirror the prior guards: an integer-coercible `index` and a non-blank
// `verbatimSnippet` are required (entry dropped otherwise); `why` defaults to "".
// Per-entry `safeParse` drops one malformed row without failing the batch.
const ContradictionSchema = z.object({
  index: z.coerce.number().int(),
  verbatimSnippet: z.string().transform((s) => norm(s)).refine((s) => s.length > 0),
  why: z.string().catch(''),
});
type ParsedContradiction = z.infer<typeof ContradictionSchema>;

const parseContradictions = (modelOut: unknown): ParsedContradiction[] => {
  const arr = (modelOut as { contradictions?: unknown })?.contradictions;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((entry) => ContradictionSchema.safeParse(entry))
    .filter((r): r is { success: true; data: ParsedContradiction } => r.success)
    .map((r) => r.data);
};

/** Verify one HTML document's sections against the KB (one model call). */
const checkDocument = async (
  candidates: SectionCandidate[],
  modelId: string,
  orgId: string,
): Promise<RawFinding[]> => {
  if (candidates.length === 0) return [];
  const { documentId, documentTitle } = candidates[0];
  const sections = candidates.map((c, i) => ({
    i,
    heading: c.heading,
    sectionText: c.sectionText.slice(0, MAX_FACTUAL_SECTION_CHARS),
    kbAnswers: c.kbHits.map((h) => `Q: ${h.question} A: ${h.answer}`),
  }));

  try {
    const body = await invokeModel(modelId, JSON.stringify(buildContradictionPrompt(documentTitle, sections)), orgId);
    const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
    const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
    const contradictions = raw ? parseContradictions(safeParseJsonFromModel(String(raw))) : [];

    return contradictions
      .filter((c) => candidates[c.index])
      .map((c, i) => {
        const cand = candidates[c.index];
        return {
          findingId: `kb-contradiction-${documentId}-${c.index}-${i}`,
          targetKind: 'RFP_DOCUMENT',
          documentId,
          documentTitle,
          // Pass the REAL heading back (never trust the model to echo it). An empty
          // heading (heading-less doc) omits the anchor → snippet-search fallback.
          anchor: cand.heading ? { kind: 'heading', text: cand.heading } : undefined,
          snippet: c.verbatimSnippet,
          issueType: 'FACTUAL_INACCURACY',
          severity: 'major',
          title: `Statement contradicts your knowledge base in "${documentTitle}"`,
          description:
            `This passage appears to contradict an approved knowledge-base answer` +
            (c.why ? `: ${c.why}.` : '.') +
            ` Verify the statement against your current company knowledge base.`,
          suggestion: `Reconcile this statement in "${documentTitle}" with your approved knowledge base.`,
        } satisfies RawFinding;
      });
  } catch (err) {
    console.warn('[compliance-review-kb-contradiction] verify call failed:', (err as Error)?.message);
    return [];
  }
};

// ─── Public entry point ──────────────────────────────────────────────────────

export const computeKbContradictionFindings = async (args: {
  orgId: string;
  projectId: string;
  modelId: string;
  inventory: PackageInventory;
}): Promise<RawFinding[]> => {
  try {
    const { orgId, projectId, modelId, inventory } = args;

    // HTML RFP documents only (forms/questionnaires excluded — D6).
    const htmlDocs = inventory.documents.filter(
      (d) => d.targetKind === 'RFP_DOCUMENT' && d.htmlContentKey,
    );
    if (htmlDocs.length === 0) return [];

    // Scope KB search to the project's linked KBs, exactly like the search handler.
    const kbIds = await getLinkedKBIds(projectId).catch(() => []);
    const scopedKbIds = kbIds.length > 0 ? kbIds : undefined;

    // Stage 1a — split every doc into sections (cheap: HTML parse only, no
    // network). Cap the FLAT section list BEFORE retrieval so a package with
    // several long docs can't fan out an unbounded number of embedding +
    // Pinecone queries — one query per capped section, never per raw section
    // (mirrors C4, which caps candidates before its per-candidate retrieval).
    const rawSections: RawSection[] = [];
    await Promise.all(
      htmlDocs.map(async (doc) => {
        try {
          const html = await loadInventoryDocHtml(inventory, doc.htmlContentKey!);
          // Non-overlapping sections so a nested heading's text is NOT also
          // scanned as part of its parent (which would double-flag the same spot
          // under two headings). Heading-less segments omit the anchor.
          for (const section of splitIntoSections(html)) {
            const sectionText = norm(section.text).slice(0, MAX_FACTUAL_SECTION_CHARS);
            if (!sectionText) continue;
            rawSections.push({
              documentId: doc.documentId,
              documentTitle: doc.title,
              heading: section.heading,
              sectionText,
            });
          }
        } catch (err) {
          console.warn(
            `[compliance-review-kb-contradiction] scan failed for ${doc.documentId}:`,
            (err as Error)?.message,
          );
        }
      }),
    );

    // Cap total sections queried across the package (retrieval + Stage-2 token
    // safety). Excess sections are dropped; the drop is visible in the
    // `factual-candidates` line (generated vs. the raw section count).
    const cappedSections = rawSections.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);

    // Stage 1b — retrieve KB hits for the CAPPED sections concurrently. Each is
    // an independent embedding + Pinecone query; order is preserved by
    // Promise.all so candidate indices stay deterministic. Sections with no
    // surviving (gated) KB hit are skipped — no model call.
    const perSection = await Promise.all(
      cappedSections.map((section) =>
        searchKnowledgeBase(orgId, section.sectionText, FACTUAL_KB_TOP_K, scopedKbIds),
      ),
    );
    const candidatesByDoc = new Map<string, SectionCandidate[]>();
    cappedSections.forEach((section, i) => {
      const kbHits = perSection[i];
      if (kbHits.length === 0) return; // no surviving KB hit → skip
      const list = candidatesByDoc.get(section.documentId) ?? [];
      list.push({ ...section, kbHits });
      candidatesByDoc.set(section.documentId, list);
    });

    // Stage 2 — one model call per document (checkDocument indexes into its own
    // candidate slice, so each doc's candidates must be verified together).
    // `generated` reports the FULL pre-cap section count so the cap-drop is
    // visible in instrumentation (matches C4's uncapped `generated`).
    const generated = rawSections.length;
    const findings: RawFinding[] = [];
    for (const docCandidates of candidatesByDoc.values()) {
      findings.push(...(await checkDocument(docCandidates, modelId, orgId)));
    }

    console.log(
      JSON.stringify({ tag: 'factual-candidates', factType: 'C3-kb-contradiction', generated, kept: findings.length }),
    );
    return findings;
  } catch (err) {
    console.warn('[compliance-review-kb-contradiction] check failed:', (err as Error)?.message);
    return [];
  }
};
