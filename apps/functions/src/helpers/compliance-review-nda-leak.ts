/**
 * C5 — NDA client-name leak detection (full review only). Highest precision of
 * the factual-accuracy checks, and the reference proof of the two-stage pipeline.
 *
 * The package is the LAST NDA-leak surface before submission (it extends the
 * existing past-performance NDA feature's leak-surface set). A client that a
 * project marks non-NAMEABLE must never appear by name anywhere in the package.
 *
 * Two-stage pipeline:
 *   Stage 1 (deterministic, high recall): every withheld client string
 *     (`listWithheldClientNames` — all non-NAMEABLE projects, including client,
 *     POC name, POC organization) is matched word-bounded + case-insensitively
 *     against every package doc/form-field/questionnaire-cell using the SAME
 *     regex `scrubNames` uses. A hit = a leak candidate with a real anchor.
 *   Stage 2 (optional prune): short/common single-word names ("Delta", "Apple")
 *     get ONE batched model call — "does this passage refer to the confidential
 *     client, or the common word?" — to drop coincidental matches. Long or
 *     multi-word names are unambiguous and skip Stage 2.
 *
 * Best-effort: any failure returns `[]` so an NDA/disclosure outage never fails
 * the review. Emits `NDA_DISCLOSURE_LEAK` / `critical`. The finding NEVER
 * re-prints the withheld name beyond the already-leaked package spot (FR-7): the
 * description states only that a confidential client name appears here.
 */
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { loadInventoryDocHtml } from '@/helpers/compliance-review-doc-cache';
import { splitIntoSections } from '@/helpers/compliance-review-html';
import { listWithheldClientNames } from '@/helpers/compliance-truth-sources';
import { MAX_FACTUAL_CANDIDATES_PER_CHECK, MAX_TOKENS_FACTUAL } from '@/constants/compliance-review';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';
import type { FindingAnchor } from '@auto-rfp/core';
import { norm, escapeRegex } from '@/helpers/compliance-review-text';
import { z } from 'zod';

/** Chars of context on each side of a match when building a verbatim snippet. */
const SNIPPET_CONTEXT = 60;
/**
 * A candidate is "ambiguous" (worth a Stage-2 model prune) when the withheld
 * string is a single word this short — common English words / brand collisions
 * ("Delta", "Apple"). Multi-word or longer names are treated as unambiguous.
 */
const AMBIGUOUS_NAME_MAX_LEN = 8;

interface LeakCandidate {
  name: string;
  targetKind: RawFinding['targetKind'];
  documentId: string;
  documentTitle: string;
  anchor?: FindingAnchor;
  snippet: string;
}

/**
 * The SAME word-bounded matcher `scrubNames` uses: case-insensitive, delimited
 * by non-word chars (or string edge). Skips names < 3 chars (too generic).
 * Returns the 0-based indices where the name STARTS in `haystack`.
 */
export const findNameMatches = (haystack: string, name: string): number[] => {
  const trimmed = name.trim();
  if (trimmed.length < 3) return [];
  // (^|[^\w]) is a captured prefix (width 1 when not at start) so the match index
  // points at the prefix char; we advance past it to the true name start.
  const re = new RegExp(`(^|[^\\w])${escapeRegex(trimmed)}(?=[^\\w]|$)`, 'gi');
  const indices: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(haystack)) !== null) {
    const prefixLen = m[1] ? m[1].length : 0;
    indices.push(m.index + prefixLen);
    // Avoid zero-width stall (the lookahead is zero-width; the prefix guarantees progress).
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return indices;
};

/** Verbatim excerpt around a match, normalized to single spaces (findable). */
const buildSnippet = (text: string, index: number, matchLen: number): string => {
  const start = Math.max(0, index - SNIPPET_CONTEXT);
  const end = Math.min(text.length, index + matchLen + SNIPPET_CONTEXT);
  return norm(text.slice(start, end));
};

const isAmbiguous = (name: string): boolean =>
  !name.includes(' ') && name.trim().length <= AMBIGUOUS_NAME_MAX_LEN;

// ─── Stage 1 — deterministic candidate generation ───────────────────────────

/**
 * Scan every package artifact for each withheld name, producing anchored leak
 * candidates. HTML docs are scanned section-by-section so each hit carries a
 * heading anchor + verbatim snippet; forms carry a field anchor; questionnaires
 * carry a cell anchor. Docs with no headings degrade to snippet-only (no anchor).
 */
const generateCandidates = async (
  names: string[],
  inventory: PackageInventory,
): Promise<LeakCandidate[]> => {
  const candidates: LeakCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: LeakCandidate) => {
    // Dedup identical (doc, spot, name) hits so one section+name isn't repeated.
    // For anchor-less candidates (heading-less HTML segments) the anchor is `{}`
    // for every segment, so include the snippet in the key — otherwise two
    // genuinely distinct leak spots in the same heading-less doc would collapse
    // to one and the second would be silently dropped.
    const spot = c.anchor ? JSON.stringify(c.anchor) : `nosnip:${c.snippet}`;
    const key = `${c.documentId}|${spot}|${c.name.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  // HTML RFP documents — section-aligned scan for heading anchors.
  await Promise.all(
    inventory.documents.map(async (doc) => {
      try {
        if (doc.targetKind === 'XLSX_QUESTIONNAIRE') {
          const cells = doc.questionnaireCells;
          if (!cells) return;
          for (const cell of cells.cells) {
            // Match + snippet on the SAME normalized string so the match index
            // lines up with the slice offset (raw value may carry collapsed
            // whitespace, which would shift the snippet window off the match).
            const value = norm(cell.value ?? '');
            for (const name of names) {
              for (const idx of findNameMatches(value, name)) {
                add({
                  name,
                  targetKind: 'XLSX_QUESTIONNAIRE',
                  documentId: doc.documentId,
                  documentTitle: doc.title,
                  anchor: { kind: 'cell', sheet: cells.sheetName, row: cell.row, col: cell.col },
                  snippet: buildSnippet(value, idx, name.length),
                });
              }
            }
          }
          return;
        }

        if (!doc.htmlContentKey) return;
        const html = await loadInventoryDocHtml(inventory, doc.htmlContentKey);

        // Non-overlapping sections: each occurrence is attributed to exactly one
        // heading (its nearest preceding one), so a single leak is NOT reported
        // once per enclosing heading level. Segments with an empty heading (text
        // before the first heading, or a heading-less doc) omit the anchor.
        for (const section of splitIntoSections(html)) {
          const sectionText = norm(section.text);
          for (const name of names) {
            for (const idx of findNameMatches(sectionText, name)) {
              add({
                name,
                targetKind: 'RFP_DOCUMENT',
                documentId: doc.documentId,
                documentTitle: doc.title,
                anchor: section.heading ? { kind: 'heading', text: section.heading } : undefined,
                snippet: buildSnippet(sectionText, idx, name.length),
              });
            }
          }
        }
      } catch (err) {
        console.warn(`[compliance-review-nda-leak] scan failed for ${doc.documentId}:`, (err as Error)?.message);
      }
    }),
  );

  // Required forms — field-value scan for field anchors.
  for (const form of inventory.forms) {
    for (const field of form.fields) {
      // Match + snippet on the SAME normalized string (see cell path above) so
      // the match index aligns with the slice offset.
      const value = norm(field.value ?? '');
      if (!value) continue;
      for (const name of names) {
        for (const idx of findNameMatches(value, name)) {
          add({
            name,
            targetKind: form.targetKind,
            documentId: form.formId,
            documentTitle: form.name,
            anchor: { kind: 'field', fieldId: field.fieldId },
            snippet: buildSnippet(value, idx, name.length),
          });
        }
      }
    }
  }

  return candidates;
};

// ─── Stage 2 — model prune for short/common names ───────────────────────────

const buildPrunePrompt = (items: Array<{ i: number; name: string; snippet: string }>) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You decide whether a passage names a specific CONFIDENTIAL CLIENT organization, or merely ' +
    'uses a common word/brand that coincidentally matches the client name. For each item you are ' +
    'given a candidate NAME and the PASSAGE it appears in. Return ONLY the indices where the ' +
    'passage genuinely refers to the confidential client organization (a real disclosure), NOT a ' +
    'coincidental common-word use. Return ONLY JSON: { "leaks": [<index>, ...] }.',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'ITEMS:\n' +
            items
              .map((it) => `#${it.i} NAME="${it.name}"\nPASSAGE: ${it.snippet}`)
              .join('\n\n') +
            '\n\nReturn the indices that are genuine confidential-client disclosures. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

/**
 * Parse the model's `leaks` array into the set of indices to KEEP. Returns `null`
 * — meaning "indeterminate, keep everything" — when the response is not a genuine
 * verdict (not an object, or no `leaks` array at all). This is the fail-closed
 * distinction: a malformed/empty 200 (`{}`, garbage, missing key) must NOT be read
 * as "the model found zero leaks", which would silently drop every ambiguous
 * candidate — exactly the short confidential names this check exists to catch. An
 * EXPLICIT `{ "leaks": [] }` is a real verdict and returns an empty set (prune all).
 */
// Model payload shape (rule 02 — validate model JSON with Zod). `.safeParse`
// failing preserves the indeterminate signal below: a response that isn't a
// genuine `{ leaks: [...] }` verdict yields `null` (keep everything), NOT an empty
// set. Non-integer-coercible entries within a real array are dropped, matching the
// prior `Number` + `Number.isInteger` filter.
const LeakVerdictSchema = z.object({
  leaks: z.array(z.coerce.number().int().catch(Number.NaN)),
});

const parseLeakIndices = (modelOut: unknown): Set<number> | null => {
  const { success, data } = LeakVerdictSchema.safeParse(modelOut);
  if (!success) return null; // not a genuine verdict → indeterminate, keep all
  return new Set(data.leaks.filter((n) => Number.isInteger(n)));
};

/**
 * Prune the ambiguous (short single-word) candidates via one batched model call.
 * Unambiguous candidates are returned untouched. On any model failure the
 * ambiguous candidates are KEPT (fail toward reporting — an NDA leak is critical;
 * a false positive is safer than a missed disclosure).
 */
const pruneAmbiguous = async (candidates: LeakCandidate[], modelId: string): Promise<LeakCandidate[]> => {
  const ambiguousIdx = candidates
    .map((c, i) => (isAmbiguous(c.name) ? i : -1))
    .filter((i) => i >= 0);
  if (ambiguousIdx.length === 0) return candidates;

  try {
    const items = ambiguousIdx.map((i) => ({ i, name: candidates[i].name, snippet: candidates[i].snippet }));
    const body = await invokeModel(modelId, JSON.stringify(buildPrunePrompt(items)));
    const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
    const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
    // A missing text block, or a response that isn't a genuine `{ leaks: [...] }`
    // verdict, is INDETERMINATE — keep every ambiguous candidate (fail closed).
    // Only an explicit `leaks` array prunes; `{ "leaks": [] }` prunes all.
    const keep = raw ? parseLeakIndices(safeParseJsonFromModel(String(raw))) : null;
    if (keep === null) return candidates;
    return candidates.filter((_, i) => !isAmbiguous(candidates[i].name) || keep.has(i));
  } catch (err) {
    console.warn('[compliance-review-nda-leak] Stage-2 prune failed; keeping candidates:', (err as Error)?.message);
    return candidates;
  }
};

// ─── Public entry point ──────────────────────────────────────────────────────

export const computeNdaLeakFindings = async (args: {
  orgId: string;
  modelId: string;
  inventory: PackageInventory;
}): Promise<RawFinding[]> => {
  try {
    const { orgId, modelId, inventory } = args;
    const withheld = await listWithheldClientNames(orgId);
    if (withheld.length === 0) return [];

    // Distinct names (case-insensitive) — one project's client and another's POC
    // org can be the same string; we only need to scan each distinct string once.
    const names = Array.from(new Set(withheld.map((w) => w.name).filter((n) => n.trim().length >= 3)));

    const allCandidates = await generateCandidates(names, inventory);
    const generated = allCandidates.length;

    // The Stage-2 cap exists to bound the MODEL PROMPT — but Stage 2 only prunes
    // AMBIGUOUS (short single-word) names. Unambiguous multi-word/long names are
    // high-confidence leaks the model never sees, so capping THEM would silently
    // drop a critical disclosure to protect a prompt they don't enter. Partition
    // so the cap gates only the ambiguous set.
    const unambiguous = allCandidates.filter((c) => !isAmbiguous(c.name));
    const ambiguous = allCandidates.filter((c) => isAmbiguous(c.name));

    // Cap ONLY the ambiguous candidates fed to Stage 2. Overflow is dropped from
    // verification (never emitted as an individual finding — it's unverified) but
    // is counted into the visible summary below.
    const cappedAmbiguous = ambiguous.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);
    const unverifiedAmbiguous = ambiguous.length - cappedAmbiguous.length;
    const keptAmbiguous = await pruneAmbiguous(cappedAmbiguous, modelId);

    // Emit unambiguous leaks FIRST (highest confidence), then surviving ambiguous
    // ones. Bound the number of INDIVIDUAL findings so a pathological package
    // (the same name repeated thousands of times) can't blow the DynamoDB
    // run-item size limit — but the remainder is surfaced as one visible summary
    // finding below, never a silent drop (this is the last leak surface before
    // submission).
    const ordered = [...unambiguous, ...keptAmbiguous];
    const emitted = ordered.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);
    const trimmedReal = ordered.length - emitted.length;
    const unshown = unverifiedAmbiguous + trimmedReal;

    const findings: RawFinding[] = emitted.map((c, i) => ({
      findingId: `nda-leak-${c.documentId}-${i}`,
      targetKind: c.targetKind,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      anchor: c.anchor,
      // The snippet is the already-leaked package text; it is the only place the
      // name appears in the finding. We deliberately do NOT re-print the name in
      // the description/suggestion (FR-7 — no leak beyond the existing spot).
      snippet: c.snippet,
      issueType: 'NDA_DISCLOSURE_LEAK',
      severity: 'critical',
      title: `Confidential client name disclosed in "${c.documentTitle}"`,
      description:
        'A client name that is marked confidential (NDA / permission-required) in your past-performance ' +
        'records appears at this location in the submission package. Disclosing it may breach an NDA or ' +
        'client agreement.',
      suggestion:
        'Remove or anonymize the confidential client reference here (e.g. "a federal healthcare client") ' +
        'before submitting, or confirm the client is cleared as NAMEABLE in Past Performance.',
    }));

    // Never let the cap silently swallow potential leaks — surface the overflow
    // as one critical, un-anchored summary finding so the user knows to review
    // the package manually. It points at no single spot (and re-printing the
    // withheld names would itself leak — FR-7), so it carries no anchor/snippet.
    if (unshown > 0) {
      findings.push({
        findingId: 'nda-leak-overflow-summary',
        targetKind: 'RFP_DOCUMENT',
        issueType: 'NDA_DISCLOSURE_LEAK',
        severity: 'critical',
        title: `${unshown} more potential confidential-client reference${unshown === 1 ? '' : 's'} not individually listed`,
        description:
          `Beyond the leaks listed above, ${unshown} additional potential confidential-client ` +
          `reference${unshown === 1 ? ' was' : 's were'} detected in the package but could not be ` +
          `listed individually within this review's limits. This is the last NDA-leak surface before ` +
          `submission, so review the package manually for confidential client names.`,
        suggestion:
          'Manually review the package for confidential (NDA / permission-required) client names, or ' +
          'confirm the relevant clients are cleared as NAMEABLE in Past Performance, before submitting.',
      });
    }

    // FR-9 instrumentation.
    console.log(
      JSON.stringify({
        tag: 'factual-candidates',
        factType: 'C5-nda-leak',
        generated,
        kept: emitted.length,
        unshown,
      }),
    );

    return findings;
  } catch (err) {
    console.warn('[compliance-review-nda-leak] check failed:', (err as Error)?.message);
    return [];
  }
};
