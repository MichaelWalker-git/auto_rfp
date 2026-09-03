/**
 * C2 — Certification claim verification (full review only).
 *
 * A cert / set-aside CLAIMED in the package that the org can't back up is a
 * misrepresentation risk. We verify only claimed certs (held-but-not-claimed is
 * out of scope — D4). KB is the PRIMARY cert source (content-library items in a
 * cert-like category, gated), profile `fields[category==='CERTIFICATION']` + the
 * structured small-business cert are secondary — all via `loadCertRecords`.
 *
 * Two-stage pipeline:
 *   Stage 1 (deterministic): scan package text/fields for cert-like mentions
 *     from a known set (8(a), SDVOSB, WOSB, HUBZone, ISO 9001/27001, CMMI, …)
 *     plus the profile's own `smallBusinessCertId`.
 *   Stage 2 (batched model call): map each mention → a cert record (or "no
 *     match"). Then in CODE:
 *       - no match OR matched-but-unverified → UNVERIFIED_CLAIM / minor
 *       - matched record whose expiry parses to a PAST date → UNVERIFIED_CLAIM / major
 *   Best-effort expiry parse (FR-4): an unparseable date is NEVER flagged expired.
 *
 * Best-effort throughout → `[]` on any failure.
 */
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { loadInventoryDocHtml } from '@/helpers/compliance-review-doc-cache';
import { stripHtml } from '@/helpers/compliance-review-html';
import { loadCertRecords, loadCompanyFacts, type CertRecord } from '@/helpers/compliance-truth-sources';
import { nowIso } from '@/helpers/date';
import { MAX_FACTUAL_CANDIDATES_PER_CHECK, MAX_TOKENS_FACTUAL } from '@/constants/compliance-review';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';
import type { FindingAnchor } from '@auto-rfp/core';
import { norm } from '@/helpers/compliance-review-text';
import { z } from 'zod';

/**
 * Known cert / set-aside claim patterns. Each entry is a display label + a regex
 * that matches how it's written in proposals. Loose on purpose — Stage 2 maps to
 * a real record, so a stray mention that has no backing record is exactly what we
 * want to surface.
 */
const CERT_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: '8(a)', re: /\b8\s*\(\s*a\s*\)/i },
  { label: 'SDVOSB', re: /\bSDVOSB\b|\bservice[-\s]?disabled veteran[-\s]?owned\b/i },
  { label: 'VOSB', re: /\bVOSB\b|\bveteran[-\s]?owned small business\b/i },
  { label: 'WOSB', re: /\bWOSB\b|\bwomen[-\s]?owned small business\b/i },
  { label: 'EDWOSB', re: /\bEDWOSB\b/i },
  { label: 'HUBZone', re: /\bHUB[-\s]?Zone\b/i },
  { label: 'ISO 9001', re: /\bISO\s*9001\b/i },
  { label: 'ISO 27001', re: /\bISO\s*27001\b/i },
  { label: 'ISO 20000', re: /\bISO\s*20000\b/i },
  { label: 'CMMI', re: /\bCMMI(?:[-\s]?(?:level\s*)?\d)?\b/i },
  { label: 'FedRAMP', re: /\bFedRAMP\b/i },
  { label: 'SOC 2', re: /\bSOC\s*2\b/i },
  { label: 'HIPAA', re: /\bHIPAA\b/i },
];

interface CertMention {
  label: string;
  targetKind: RawFinding['targetKind'];
  documentId: string;
  documentTitle: string;
  anchor?: FindingAnchor;
  snippet: string;
}

/** Verbatim excerpt around a regex match, normalized. */
const snippetAround = (text: string, index: number, len: number): string => {
  const start = Math.max(0, index - 50);
  return norm(text.slice(start, index + len + 60));
};

const findMentionsInText = (
  text: string,
  base: Omit<CertMention, 'label' | 'snippet'>,
  extraPatterns: Array<{ label: string; re: RegExp }>,
): CertMention[] => {
  const out: CertMention[] = [];
  const seen = new Set<string>();
  for (const { label, re } of [...CERT_PATTERNS, ...extraPatterns]) {
    const m = re.exec(text);
    if (m && !seen.has(label)) {
      seen.add(label);
      out.push({ ...base, label, snippet: snippetAround(text, m.index, m[0].length) });
    }
  }
  return out;
};

// ─── Stage 2 — map mentions to cert records ──────────────────────────────────

const buildMapPrompt = (
  mentions: Array<{ i: number; label: string }>,
  records: Array<{ r: number; label: string }>,
) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You match certification/set-aside CLAIMS to the RECORDS a company actually holds. For each ' +
    'CLAIM you are given a label; for each RECORD a label. Return, for each claim index, the record ' +
    'index it refers to (same certification), or null if NO record matches the claim. Treat ' +
    'equivalent phrasings as matches (e.g. "8(a)" ~ "8(a) Business Development", "ISO 27001" ~ ' +
    '"ISO/IEC 27001"). Return ONLY JSON: { "matches": [{ "claim": <i>, "record": <r|null> }, ...] }.',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'CLAIMS:\n' +
            mentions.map((m) => `#${m.i} "${m.label}"`).join('\n') +
            '\n\nRECORDS:\n' +
            (records.length ? records.map((r) => `#${r.r} "${r.label}"`).join('\n') : '(none)') +
            '\n\nMatch each claim to a record index or null. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

// Model payload shape (rule 02 — validate model JSON with Zod). `claim` must be an
// integer-coercible index (entry dropped otherwise). `record` is the matched record
// index or null for "no match"; anything not integer-coercible (missing, non-numeric)
// falls back to null via `.catch` — the claim is KEPT with a null record, matching
// the prior guard. Per-entry `safeParse` drops one malformed row, not the batch.
const MatchSchema = z.object({
  claim: z.coerce.number().int(),
  record: z.coerce.number().int().nullable().catch(null),
});

/** claim index → record index (or null for "no match"). */
const parseMatches = (modelOut: unknown): Map<number, number | null> => {
  const out = new Map<number, number | null>();
  const arr = (modelOut as { matches?: unknown })?.matches;
  if (!Array.isArray(arr)) return out;
  for (const entry of arr) {
    const { success, data } = MatchSchema.safeParse(entry);
    if (success) out.set(data.claim, data.record);
  }
  return out;
};

/**
 * True when a cert record's expiry PARSES to a date strictly before now.
 * Best-effort (FR-4): unparseable / missing dates return false (never "expired").
 */
export const isCertExpired = (expiresAt: string | null, nowIsoStr: string): boolean => {
  if (!expiresAt) return false;
  const exp = new Date(expiresAt).getTime();
  if (Number.isNaN(exp)) return false;
  return exp < new Date(nowIsoStr).getTime();
};

// ─── Public entry point ──────────────────────────────────────────────────────

export const computeCertFindings = async (args: {
  orgId: string;
  projectId: string;
  modelId: string;
  inventory: PackageInventory;
}): Promise<RawFinding[]> => {
  try {
    const { orgId, modelId, inventory } = args;

    // Profile's own small-business cert id becomes an extra deterministic pattern.
    const profile = await loadCompanyFacts(orgId);
    const extraPatterns: Array<{ label: string; re: RegExp }> = [];
    if (profile?.smallBusinessCertId && profile.smallBusinessCertId.trim().length >= 3) {
      const id = profile.smallBusinessCertId.trim();
      extraPatterns.push({ label: id, re: new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') });
    }

    // Stage 1 — collect cert mentions across docs + forms.
    const mentions: CertMention[] = [];

    await Promise.all(
      inventory.documents
        .filter((d) => d.htmlContentKey || d.questionnaireCells)
        .map(async (d) => {
          try {
            const text = d.htmlContentKey
              ? norm(stripHtml(await loadInventoryDocHtml(inventory, d.htmlContentKey)))
              : (d.questionnaireCells?.cells.map((c) => norm(c.value)).filter(Boolean).join(' | ') ?? '');
            if (!text) return;
            mentions.push(
              ...findMentionsInText(
                text,
                { targetKind: d.targetKind, documentId: d.documentId, documentTitle: d.title },
                extraPatterns,
              ),
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
        const found = findMentionsInText(
          `${norm(field.label ?? '')}: ${value}`,
          {
            targetKind: form.targetKind,
            documentId: form.formId,
            documentTitle: form.name,
            anchor: { kind: 'field', fieldId: field.fieldId },
          },
          extraPatterns,
        );
        mentions.push(...found);
      }
    }

    const generated = mentions.length;
    if (generated === 0) {
      console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C2-cert', generated: 0, kept: 0 }));
      return [];
    }

    const capped = mentions.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);

    // Distinct claimed labels drive the record lookup + the mapping call.
    const distinctLabels = Array.from(new Set(capped.map((m) => m.label)));
    const records = await loadCertRecords(orgId, distinctLabels.join(', '));

    // Stage 2 — map each distinct claim to a record (or null).
    const mapItems = distinctLabels.map((label, i) => ({ i, label }));
    const recItems = records.map((r, i) => ({ r: i, label: r.label }));
    let claimToRecord = new Map<number, number | null>();
    try {
      const body = await invokeModel(modelId, JSON.stringify(buildMapPrompt(mapItems, recItems)), orgId);
      const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
      const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
      const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
      claimToRecord = raw ? parseMatches(safeParseJsonFromModel(String(raw))) : new Map();
    } catch (err) {
      console.warn('[compliance-review-cert] mapping call failed:', (err as Error)?.message);
      // Fall through: with no map, every claim is treated as "no match" → minor.
    }

    const now = nowIso();
    const labelToRecord = new Map<string, CertRecord | null>();
    distinctLabels.forEach((label, i) => {
      const recIdx = claimToRecord.get(i);
      labelToRecord.set(label, recIdx !== null && recIdx !== undefined ? records[recIdx] ?? null : null);
    });

    const kept: RawFinding[] = [];
    capped.forEach((mention, i) => {
      const record = labelToRecord.get(mention.label) ?? null;
      const expired = record ? isCertExpired(record.expiresAt, now) : false;
      const unverified = !record || !record.verified;
      // Only surface unbacked or expired claims; a verified, unexpired match is fine.
      if (!unverified && !expired) return;

      const severity: RawFinding['severity'] = expired ? 'major' : 'minor';
      const reason = !record
        ? `no matching certification record was found in your knowledge base or company profile`
        : expired
          ? `the matching record appears to be EXPIRED (expiry ${record.expiresAt})`
          : `the matching record is not verified/approved`;

      kept.push({
        findingId: `cert-${mention.documentId}-${i}`,
        targetKind: mention.targetKind,
        documentId: mention.documentId,
        documentTitle: mention.documentTitle,
        anchor: mention.anchor,
        snippet: mention.snippet,
        issueType: 'UNVERIFIED_CLAIM',
        severity,
        title: `Unverified certification claim "${mention.label}" in "${mention.documentTitle}"`,
        description:
          `This document claims the "${mention.label}" certification/set-aside, but ${reason}. ` +
          `Presenting an unbacked or expired certification is a misrepresentation risk.`,
        suggestion:
          `Confirm the "${mention.label}" certification is current and recorded (approved in the knowledge ` +
          `base or company profile), or remove/qualify the claim in "${mention.documentTitle}".`,
      });
    });

    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C2-cert', generated, kept: kept.length }));
    return kept;
  } catch (err) {
    console.warn('[compliance-review-cert] check failed:', (err as Error)?.message);
    return [];
  }
};
