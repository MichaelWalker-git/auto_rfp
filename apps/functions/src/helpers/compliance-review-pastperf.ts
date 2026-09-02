/**
 * C4 — Past-performance value verification (full review only).
 *
 * A past-performance reference in the package can state a contract VALUE (dollar
 * amount) or CONTRACT NUMBER that doesn't match our own records — a factual
 * error that undermines credibility. v1 verifies ONLY these formatted values
 * (fuzzy client/date prose matching is out — D8).
 *
 * Two-stage pipeline:
 *   Stage 1 (deterministic): scan package prose for PP-reference-like passages
 *     that carry a formatted value — a dollar amount ($X) or a contract-number
 *     token — and capture the surrounding snippet.
 *   Stage 2 (batched model call): for each candidate, retrieve the best-matching
 *     USABLE past-performance record (`searchPastPerformanceUsable` — already
 *     NDA-redacted, DO_NOT_USE dropped), and let the model confirm it's the same
 *     engagement and whether the stated value/contract number contradicts the
 *     record. Mismatch → FACTUAL_INACCURACY / major.
 *
 * NDA (FR-7): records are pre-redacted — a withheld client name can never reach
 * a finding. Best-effort throughout → `[]` on any failure.
 */
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { loadInventoryDocHtml } from '@/helpers/compliance-review-doc-cache';
import { stripHtml } from '@/helpers/compliance-review-html';
import { searchPastPerformanceUsable, type PastPerfFact } from '@/helpers/compliance-truth-sources';
import {
  FACTUAL_PP_TOP_K,
  MAX_FACTUAL_CANDIDATES_PER_CHECK,
  MAX_TOKENS_FACTUAL,
} from '@/constants/compliance-review';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';
import type { FindingAnchor } from '@auto-rfp/core';
import { norm, dollarRegex } from '@/helpers/compliance-review-text';
import { z } from 'zod';

// A contract-number-like token: mixes letters+digits with dashes, ≥6 chars.
// (e.g. W912DY-20-C-0043, GS-35F-1234A) — kept adjacent to a value/PP cue.
const CONTRACT_RE = /\b[A-Z0-9]{2,}(?:-[A-Z0-9]+){1,}\b/g;
// Words that suggest the passage is about a past engagement (loose PP cue).
const PP_CUE_RE = /\b(contract|project|task order|engagement|awarded|delivered|client|performance|value|ceiling)\b/i;

interface PpCandidate {
  targetKind: RawFinding['targetKind'];
  documentId: string;
  documentTitle: string;
  anchor?: FindingAnchor;
  snippet: string;
  statedValue: string | null;
  statedContract: string | null;
}

/** Non-overlapping sentences that carry a PP cue AND a formatted value. */
const extractCandidates = (
  text: string,
  base: Omit<PpCandidate, 'snippet' | 'statedValue' | 'statedContract'>,
): PpCandidate[] => {
  const out: PpCandidate[] = [];
  const dollarRe = dollarRegex();
  // Split on sentence-ish boundaries and pipes (cells/fields join with " | ").
  const chunks = text.split(/(?<=[.!?])\s+|\s\|\s/);
  for (const chunk of chunks) {
    if (!PP_CUE_RE.test(chunk)) continue;
    CONTRACT_RE.lastIndex = 0;
    const dollar = chunk.match(dollarRe);
    const contract = chunk.match(CONTRACT_RE);
    if (!dollar && !contract) continue;
    out.push({
      ...base,
      snippet: norm(chunk).slice(0, 300),
      statedValue: dollar ? dollar[0].trim() : null,
      statedContract: contract ? contract[0].trim() : null,
    });
  }
  return out;
};

// ─── Stage 2 — verify against the matched record ─────────────────────────────

const buildVerifyPrompt = (
  items: Array<{ i: number; snippet: string; statedValue: string | null; statedContract: string | null; records: PastPerfFact[] }>,
) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You verify past-performance figures in a proposal against the company\'s own records. For each ' +
    'item you are given a PASSAGE that references a past engagement, the STATED value/contract number, ' +
    'and candidate RECORDS (title, value, contractNumber). Decide whether the passage refers to the ' +
    'SAME engagement as one record AND the stated value or contract number CONTRADICTS that record. ' +
    'Only report a genuine numeric/identifier mismatch for the same engagement — never a different ' +
    'project, and never when you are unsure it is the same engagement. Return ONLY JSON: ' +
    '{ "mismatches": [{ "index": <i>, "field": "value"|"contractNumber", "stated": "<x>", "actual": "<y>" }, ...] }.',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'ITEMS:\n' +
            items
              .map(
                (it) =>
                  `#${it.i} PASSAGE: ${it.snippet}\n` +
                  `STATED value=${it.statedValue ?? '(none)'} contract=${it.statedContract ?? '(none)'}\n` +
                  `RECORDS:\n` +
                  (it.records.length
                    ? it.records
                        .map(
                          (r) =>
                            `- "${r.title}" value=${r.value ?? '(none)'} contractNumber=${r.contractNumber ?? '(none)'}`,
                        )
                        .join('\n')
                    : '(none)'),
              )
              .join('\n\n---\n\n') +
            '\n\nReturn only genuine same-engagement mismatches. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

// Model payload shape (rule 02 — validate dynamic/model JSON with Zod, don't hand-
// guard). Coercion + `.catch` mirror the prior guards exactly: an integer-coercible
// `index` is required (entry dropped otherwise); a non-string `field` falls back to
// "value"; `stated`/`actual` default to "". Per-entry `safeParse` means one malformed
// row is dropped, not the whole batch.
const MismatchSchema = z.object({
  index: z.coerce.number().int(),
  field: z.string().catch('value'),
  stated: z.string().catch(''),
  actual: z.string().catch(''),
});
type ParsedMismatch = z.infer<typeof MismatchSchema>;

const parseMismatches = (modelOut: unknown): ParsedMismatch[] => {
  const arr = (modelOut as { mismatches?: unknown })?.mismatches;
  if (!Array.isArray(arr)) return [];
  return arr
    .map((entry) => MismatchSchema.safeParse(entry))
    .filter((r): r is { success: true; data: ParsedMismatch } => r.success)
    .map((r) => r.data);
};

// ─── Public entry point ──────────────────────────────────────────────────────

export const computePastPerfValueFindings = async (args: {
  orgId: string;
  modelId: string;
  inventory: PackageInventory;
}): Promise<RawFinding[]> => {
  try {
    const { orgId, modelId, inventory } = args;

    // Stage 1 — gather candidates across HTML docs + questionnaires + forms.
    const candidates: PpCandidate[] = [];

    await Promise.all(
      inventory.documents
        .filter((d) => d.htmlContentKey || d.questionnaireCells)
        .map(async (d) => {
          try {
            const text = d.htmlContentKey
              ? norm(stripHtml(await loadInventoryDocHtml(inventory, d.htmlContentKey)))
              : (d.questionnaireCells?.cells.map((c) => norm(c.value)).filter(Boolean).join(' | ') ?? '');
            if (!text) return;
            candidates.push(
              ...extractCandidates(text, {
                targetKind: d.targetKind,
                documentId: d.documentId,
                documentTitle: d.title,
              }),
            );
          } catch {
            /* skip unreadable doc */
          }
        }),
    );

    for (const form of inventory.forms) {
      for (const field of form.fields) {
        const value = norm(field.value ?? '');
        if (!value) continue;
        candidates.push(
          ...extractCandidates(`${norm(field.label ?? '')}: ${value}`, {
            targetKind: form.targetKind,
            documentId: form.formId,
            documentTitle: form.name,
            anchor: { kind: 'field', fieldId: field.fieldId },
          }),
        );
      }
    }

    const generated = candidates.length;
    if (generated === 0) {
      console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C4-pastperf', generated: 0, kept: 0 }));
      return [];
    }

    const capped = candidates.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);

    // Retrieve best-matching USABLE (redacted) records per candidate.
    const withRecords = await Promise.all(
      capped.map(async (c, i) => ({
        i,
        snippet: c.snippet,
        statedValue: c.statedValue,
        statedContract: c.statedContract,
        records: await searchPastPerformanceUsable(orgId, c.snippet, FACTUAL_PP_TOP_K),
      })),
    );
    // Only verify candidates that actually retrieved a record to compare against.
    const verifiable = withRecords.filter((it) => it.records.length > 0);
    if (verifiable.length === 0) {
      console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C4-pastperf', generated, kept: 0 }));
      return [];
    }

    let mismatches: ParsedMismatch[] = [];
    try {
      const body = await invokeModel(modelId, JSON.stringify(buildVerifyPrompt(verifiable)), orgId);
      const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
      const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
      const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
      mismatches = raw ? parseMismatches(safeParseJsonFromModel(String(raw))) : [];
    } catch (err) {
      console.warn('[compliance-review-pastperf] verify call failed:', (err as Error)?.message);
      console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C4-pastperf', generated, kept: 0 }));
      return [];
    }

    const findings: RawFinding[] = [];
    // Suffix the findingId with the emission ordinal: the model can return the
    // same `index` more than once (e.g. a value AND a contractNumber mismatch on
    // the same candidate), which are distinct findings with distinct fingerprints
    // — so `pastperf-<doc>-<index>` alone is not unique. The ordinal guarantees a
    // unique id per emitted finding; true full-duplicates still collapse via the
    // downstream fingerprint dedup.
    mismatches.forEach((m, emitIdx) => {
      const cand = capped[m.index];
      if (!cand) return;
      const fieldLabel = m.field === 'contractNumber' ? 'contract number' : 'contract value';
      findings.push({
        findingId: `pastperf-${cand.documentId}-${m.index}-${emitIdx}`,
        targetKind: cand.targetKind,
        documentId: cand.documentId,
        documentTitle: cand.documentTitle,
        anchor: cand.anchor,
        snippet: cand.snippet,
        issueType: 'FACTUAL_INACCURACY',
        severity: 'major',
        title: `Past-performance ${fieldLabel} does not match your records in "${cand.documentTitle}"`,
        description:
          `This reference states a ${fieldLabel} of "${m.stated}", but your past-performance record for ` +
          `the same engagement shows "${m.actual}". A mismatched figure undermines the reference.`,
        suggestion: `Correct the ${fieldLabel} in "${cand.documentTitle}" to match your past-performance record ("${m.actual}").`,
      });
    });

    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C4-pastperf', generated, kept: findings.length }));
    return findings;
  } catch (err) {
    console.warn('[compliance-review-pastperf] check failed:', (err as Error)?.message);
    return [];
  }
};
