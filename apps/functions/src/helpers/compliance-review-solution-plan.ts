/**
 * C6 — Solution-plan consistency (full review only).
 *
 * The submission package must be TRUE TO THE LATEST SOLUTION PLAN — same
 * approach, team, prices, and services. The plan is the win strategy (a source
 * of truth distinct from company facts), so a package that contradicts it is a
 * SOLUTION_PLAN_MISMATCH.
 *
 * The plan has two shapes, checked separately:
 *   C6a — STRUCTURED cost schedule (service label + amount + billing). Two-stage:
 *     Stage 1 (deterministic): scan the package for a passage/field/cell that
 *       mentions a priced service label AND carries a formatted price.
 *     Stage 2 (ONE batched model call): confirm SAME-service price/billing
 *       contradictions vs the plan. Mirrors compliance-review-pastperf.ts.
 *   C6b — PROSE (approach/team/services). Runs on HTML RFP docs only. Two-stage:
 *     Stage 1: split each doc into sections (heading = anchor, text = snippet).
 *     Stage 2 (ONE batched model call per doc): return sections that contradict
 *       the plan text, with a verbatim snippet. Mirrors
 *       compliance-review-kb-contradiction.ts.
 *   C6c — STRUCTURED team roster (role → assigned person). The plan's recommended
 *     team lives in the `planTeam` sidecar, written AFTER synthesis — it is NOT in
 *     the plan prose C6b reads — so team consistency needs its own structured check.
 *     Two-stage (mirrors C6a):
 *     Stage 1 (deterministic): scan the package for a passage/field/cell that
 *       mentions a plan role AND names a person.
 *     Stage 2 (ONE batched model call): confirm SAME-role staffing contradictions
 *       (the package assigns a DIFFERENT person to a role than the plan does).
 *   C6d — STRUCTURED person→role (the transpose of C6c). C6c catches a plan ROLE
 *     staffed by a DIFFERENT PERSON; C6d catches the SAME plan PERSON listed under a
 *     DIFFERENT ROLE than the plan assigns them. Because roles are open-vocabulary
 *     (no role regex the way names have one), Stage 1 anchors on the PERSON (a finite
 *     plan set) and hands any role-bearing passage to the model.
 *     Two-stage (mirrors C6c, transposed):
 *     Stage 1 (deterministic): scan the package for a passage/field/cell that
 *       names a plan person AND plausibly states a role, where that role is NOT the
 *       person's plan role.
 *     Stage 2 (ONE batched model call): confirm SAME-person role contradictions
 *       (the package lists a DIFFERENT role for a person than the plan does).
 *
 * Coverage is CONTRADICTIONS ONLY (v1) — a different price/person/role/approach/
 * service, never a mere omission or extra detail. The latest READY plan is used even when
 * it is stale (mirrors document generation). Best-effort throughout → `[]` on any
 * failure so a solution-plan/S3 outage never fails a review. Emits
 * SOLUTION_PLAN_MISMATCH / major, and every path logs a `factual-candidates` line.
 */
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { loadInventoryDocHtml } from '@/helpers/compliance-review-doc-cache';
import { stripHtml, splitIntoSections } from '@/helpers/compliance-review-html';
import { norm, tokens, containsWord, dollarRegex, personNameRegex, escapeRegex } from '@/helpers/compliance-review-text';
import {
  loadSolutionPlanFacts,
  type SolutionPlanFacts,
  type SolutionPlanCostLine,
  type SolutionPlanTeamLine,
} from '@/helpers/compliance-truth-sources';
import {
  MAX_FACTUAL_CANDIDATES_PER_CHECK,
  MAX_FACTUAL_SECTION_CHARS,
  MAX_SOLUTION_PLAN_TEXT_CHARS,
  MAX_TOKENS_FACTUAL,
} from '@/constants/compliance-review';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';
import type { FindingAnchor } from '@auto-rfp/core';

/**
 * Whether a passage plausibly references a priced service line: the whole label
 * appears as a word, OR (for multi-word labels) enough of its distinctive tokens
 * do. Loose on purpose — Stage 2 is the precision gate.
 */
const mentionsService = (text: string, label: string): boolean => {
  if (containsWord(text, label)) return true;
  const labelToks = tokens(label);
  if (labelToks.length < 2) return false;
  const textToks = new Set(tokens(text));
  const overlap = labelToks.filter((t) => textToks.has(t)).length;
  // Require a majority of the label's tokens present (and at least two) so a
  // single common word ("services", "support") doesn't match everything.
  return overlap >= 2 && overlap >= Math.ceil(labelToks.length / 2);
};

// ─── C6a — cost-schedule consistency ─────────────────────────────────────────

interface CostCandidate {
  item: SolutionPlanCostLine;
  targetKind: RawFinding['targetKind'];
  documentId: string;
  documentTitle: string;
  anchor?: FindingAnchor;
  snippet: string;
  statedPrice: string;
}

/** Sentences/cells that name a priced service AND carry a formatted price. */
const extractCostCandidates = (
  text: string,
  items: SolutionPlanCostLine[],
  base: Omit<CostCandidate, 'item' | 'snippet' | 'statedPrice'>,
): CostCandidate[] => {
  const out: CostCandidate[] = [];
  const dollarRe = dollarRegex();
  const chunks = text.split(/(?<=[.!?])\s+|\s\|\s/);
  for (const chunk of chunks) {
    const dollar = chunk.match(dollarRe);
    if (!dollar) continue;
    for (const item of items) {
      if (!mentionsService(chunk, item.label)) continue;
      out.push({
        ...base,
        item,
        snippet: norm(chunk).slice(0, 300),
        statedPrice: dollar[0].trim(),
      });
    }
  }
  return out;
};

const buildCostVerifyPrompt = (
  currency: string,
  items: Array<{ i: number; serviceLabel: string; planAmount: number; planBilling: string; snippet: string; statedPrice: string }>,
) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You verify service prices in a proposal against the company\'s authoritative SOLUTION PLAN cost ' +
    'schedule. For each item you are given a SERVICE label, the plan AMOUNT and BILLING cadence, the ' +
    `plan CURRENCY (${currency}), a PASSAGE from the proposal, and the STATED price in that passage. ` +
    'Decide whether the passage prices the SAME service as the plan line AND the stated price or billing ' +
    'cadence CONTRADICTS the plan. Only report a genuine mismatch for the SAME service — never a ' +
    'different service, and never when you are unsure it is the same service. Return ONLY JSON: ' +
    '{ "mismatches": [{ "index": <i>, "field": "price"|"billing", "stated": "<x>", "plan": "<y>" }, ...] }.',
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
                  `#${it.i} SERVICE="${it.serviceLabel}" planAmount=${it.planAmount} planBilling=${it.planBilling}\n` +
                  `PASSAGE: ${it.snippet}\nSTATED price=${it.statedPrice}`,
              )
              .join('\n\n---\n\n') +
            '\n\nReturn only genuine same-service price/billing mismatches. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

interface ParsedCostMismatch {
  index: number;
  field: string;
  stated: string;
  plan: string;
}

const parseCostMismatches = (modelOut: unknown): ParsedCostMismatch[] => {
  if (!modelOut || typeof modelOut !== 'object') return [];
  const arr = (modelOut as Record<string, unknown>).mismatches;
  if (!Array.isArray(arr)) return [];
  const out: ParsedCostMismatch[] = [];
  for (const entry of arr) {
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      const index = Number(e.index);
      if (Number.isInteger(index)) {
        out.push({
          index,
          field: typeof e.field === 'string' ? e.field : 'price',
          stated: typeof e.stated === 'string' ? e.stated : '',
          plan: typeof e.plan === 'string' ? e.plan : '',
        });
      }
    }
  }
  return out;
};

const computePlanCostFindings = async (
  plan: SolutionPlanFacts,
  inventory: PackageInventory,
  modelId: string,
): Promise<RawFinding[]> => {
  const items = plan.costItems;
  if (items.length === 0) {
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6a-plan-cost', generated: 0, kept: 0 }));
    return [];
  }

  // Stage 1 — gather candidates across HTML docs + questionnaires + forms.
  const candidates: CostCandidate[] = [];

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
            ...extractCostCandidates(text, items, {
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
        ...extractCostCandidates(`${norm(field.label ?? '')}: ${value}`, items, {
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
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6a-plan-cost', generated: 0, kept: 0 }));
    return [];
  }

  const capped = candidates.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);

  let mismatches: ParsedCostMismatch[] = [];
  try {
    const promptItems = capped.map((c, i) => ({
      i,
      serviceLabel: c.item.label,
      planAmount: c.item.amount,
      planBilling: c.item.billing,
      snippet: c.snippet,
      statedPrice: c.statedPrice,
    }));
    const body = await invokeModel(modelId, JSON.stringify(buildCostVerifyPrompt(plan.currency, promptItems)));
    const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
    const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
    mismatches = raw ? parseCostMismatches(safeParseJsonFromModel(String(raw))) : [];
  } catch (err) {
    console.warn('[compliance-review-solution-plan] cost verify call failed:', (err as Error)?.message);
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6a-plan-cost', generated, kept: 0 }));
    return [];
  }

  const findings: RawFinding[] = [];
  // Suffix the findingId with the emission ordinal: the model can return the same
  // `index` twice (a price AND a billing mismatch on one candidate) — distinct
  // findings with distinct fingerprints — so `-<index>` alone is not unique.
  mismatches.forEach((m, emitIdx) => {
    const cand = capped[m.index];
    if (!cand) return;
    const isBilling = m.field === 'billing';
    const fieldLabel = isBilling ? 'billing cadence' : 'price';
    // The plan reference always shows the full price + cadence, regardless of
    // which field mismatched. `planValue` is the specific plan value for the
    // mismatched field (used in the "should be …" clause); `planRef` is the full
    // plan line for context.
    const planPrice = `${plan.currency} ${cand.item.amount}`;
    const planValue = isBilling ? cand.item.billing : planPrice;
    const planRef = `${planPrice} (${cand.item.billing})`;
    // Fallback when the model returns an empty `stated` (malformed — it's told to
    // fill it). For a PRICE mismatch, `statedPrice` is a genuine scanned value.
    // For a BILLING mismatch there is NO scanned cadence to fall back to, so use
    // "(unspecified)" — NOT `cand.item.billing`, which is the PLAN's own cadence
    // and would make the description self-contradictory ("plan prices X at monthly
    // … but this document states a billing cadence of monthly").
    const statedValue = m.stated || (isBilling ? '(unspecified)' : cand.statedPrice);
    findings.push({
      findingId: `solution-plan-cost-${cand.documentId}-${m.index}-${emitIdx}`,
      targetKind: cand.targetKind,
      documentId: cand.documentId,
      documentTitle: cand.documentTitle,
      anchor: cand.anchor,
      snippet: cand.snippet,
      issueType: 'SOLUTION_PLAN_MISMATCH',
      severity: 'major',
      title: `${isBilling ? 'Billing cadence' : 'Price'} for "${cand.item.label}" does not match the solution plan in "${cand.documentTitle}"`,
      description:
        `The solution plan prices "${cand.item.label}" at ${planRef}, but this document states a ` +
        `${fieldLabel} of "${statedValue}". The package must match the latest approved solution plan.`,
      suggestion:
        `Update the ${fieldLabel} for "${cand.item.label}" in "${cand.documentTitle}" to match the solution ` +
        `plan (${planValue}), or regenerate the plan if it has changed.`,
    });
  });

  console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6a-plan-cost', generated, kept: findings.length }));
  return findings;
};

// ─── C6b — prose contradiction (approach / team / services) ──────────────────

interface ProseSection {
  documentId: string;
  documentTitle: string;
  heading: string;
  sectionText: string;
}

const buildProsePrompt = (
  planText: string,
  documentTitle: string,
  sections: Array<{ i: number; heading: string; sectionText: string }>,
) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You detect where a proposal SECTION contradicts the company\'s authoritative SOLUTION PLAN — the ' +
    'approved approach, team composition, selected services, and timeline. You are given the SOLUTION ' +
    'PLAN text and a set of proposal sections. Return ONLY genuine contradictions — where a section ' +
    'states a DIFFERENT approach, team/staffing, service, or figure than the plan (NOT a mere omission, ' +
    'extra detail, or different wording). For each, copy a SHORT VERBATIM excerpt from the section text ' +
    '(do not paraphrase). Return ONLY JSON: ' +
    '{ "contradictions": [{ "index": <i>, "verbatimSnippet": "<exact excerpt>", "why": "<one line>" }, ...] }.',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `SOLUTION PLAN:\n${planText}\n\n` +
            `DOCUMENT: "${documentTitle}"\n\nSECTIONS:\n` +
            sections
              .map((s) => `#${s.i} HEADING="${s.heading}"\nSECTION TEXT: ${s.sectionText}`)
              .join('\n\n---\n\n') +
            '\n\nReturn only genuine contradictions with a verbatim snippet. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

interface ParsedProseContradiction {
  index: number;
  verbatimSnippet: string;
  why: string;
}

const parseProseContradictions = (modelOut: unknown): ParsedProseContradiction[] => {
  if (!modelOut || typeof modelOut !== 'object') return [];
  const arr = (modelOut as Record<string, unknown>).contradictions;
  if (!Array.isArray(arr)) return [];
  const out: ParsedProseContradiction[] = [];
  for (const entry of arr) {
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      const index = Number(e.index);
      const verbatimSnippet = typeof e.verbatimSnippet === 'string' ? e.verbatimSnippet : '';
      const why = typeof e.why === 'string' ? e.why : '';
      if (Number.isInteger(index) && verbatimSnippet.trim()) {
        out.push({ index, verbatimSnippet: norm(verbatimSnippet), why });
      }
    }
  }
  return out;
};

/** Verify one HTML document's sections against the plan (one model call). */
const checkDocumentProse = async (
  planText: string,
  candidates: ProseSection[],
  modelId: string,
): Promise<RawFinding[]> => {
  if (candidates.length === 0) return [];
  const { documentId, documentTitle } = candidates[0];
  const sections = candidates.map((c, i) => ({
    i,
    heading: c.heading,
    sectionText: c.sectionText.slice(0, MAX_FACTUAL_SECTION_CHARS),
  }));

  try {
    const body = await invokeModel(modelId, JSON.stringify(buildProsePrompt(planText, documentTitle, sections)));
    const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
    const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
    const contradictions = raw ? parseProseContradictions(safeParseJsonFromModel(String(raw))) : [];

    return contradictions
      .filter((c) => candidates[c.index])
      .map((c, i) => {
        const cand = candidates[c.index];
        return {
          findingId: `solution-plan-prose-${documentId}-${c.index}-${i}`,
          targetKind: 'RFP_DOCUMENT',
          documentId,
          documentTitle,
          // Pass the REAL heading back (never trust the model to echo it). An
          // empty heading (heading-less doc) omits the anchor → snippet fallback.
          anchor: cand.heading ? { kind: 'heading', text: cand.heading } : undefined,
          snippet: c.verbatimSnippet,
          issueType: 'SOLUTION_PLAN_MISMATCH',
          severity: 'major',
          title: `Statement contradicts the solution plan in "${documentTitle}"`,
          description:
            `This passage appears to contradict the approved solution plan` +
            (c.why ? `: ${c.why}.` : '.') +
            ` The package must reflect the plan's approach, team, and services.`,
          suggestion: `Reconcile this statement in "${documentTitle}" with the latest solution plan.`,
        } satisfies RawFinding;
      });
  } catch (err) {
    console.warn('[compliance-review-solution-plan] prose verify call failed:', (err as Error)?.message);
    return [];
  }
};

const computePlanProseFindings = async (
  plan: SolutionPlanFacts,
  inventory: PackageInventory,
  modelId: string,
): Promise<RawFinding[]> => {
  const planText = plan.text.slice(0, MAX_SOLUTION_PLAN_TEXT_CHARS);
  if (!planText.trim()) {
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6b-plan-prose', generated: 0, kept: 0 }));
    return [];
  }

  // HTML RFP documents only (forms/questionnaires covered by C6a).
  const htmlDocs = inventory.documents.filter((d) => d.targetKind === 'RFP_DOCUMENT' && d.htmlContentKey);
  if (htmlDocs.length === 0) {
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6b-plan-prose', generated: 0, kept: 0 }));
    return [];
  }

  // Stage 1 — build section candidates per doc.
  const perDoc: ProseSection[][] = await Promise.all(
    htmlDocs.map(async (doc) => {
      try {
        const html = await loadInventoryDocHtml(inventory, doc.htmlContentKey!);
        const sections = splitIntoSections(html);
        const candidates: ProseSection[] = [];
        for (const section of sections) {
          const sectionText = norm(section.text).slice(0, MAX_FACTUAL_SECTION_CHARS);
          if (!sectionText) continue;
          candidates.push({
            documentId: doc.documentId,
            documentTitle: doc.title,
            heading: section.heading,
            sectionText,
          });
        }
        return candidates;
      } catch (err) {
        console.warn(
          `[compliance-review-solution-plan] prose scan failed for ${doc.documentId}:`,
          (err as Error)?.message,
        );
        return [];
      }
    }),
  );

  // Cap total section candidates across the package (Stage-2 token safety).
  let remaining = MAX_FACTUAL_CANDIDATES_PER_CHECK;
  let generated = 0;
  const findings: RawFinding[] = [];
  for (const docCandidates of perDoc) {
    if (remaining <= 0) break;
    const slice = docCandidates.slice(0, remaining);
    remaining -= slice.length;
    generated += slice.length;
    if (slice.length === 0) continue;
    findings.push(...(await checkDocumentProse(planText, slice, modelId)));
  }

  console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6b-plan-prose', generated, kept: findings.length }));
  return findings;
};

// ─── C6c — team-roster consistency (role → assigned person) ──────────────────

interface TeamCandidate {
  item: SolutionPlanTeamLine;
  targetKind: RawFinding['targetKind'];
  documentId: string;
  documentTitle: string;
  anchor?: FindingAnchor;
  snippet: string;
  /** The person name(s) found near the role mention — the disputed staffing. */
  statedNames: string;
}

/**
 * Whether a passage plausibly references a plan role: the whole role label
 * appears as a word, OR (for multi-word roles) enough of its distinctive tokens
 * do. Mirrors `mentionsService` — loose on purpose; Stage 2 is the precision gate.
 */
const mentionsRole = (text: string, role: string): boolean => {
  if (containsWord(text, role)) return true;
  const roleToks = tokens(role);
  if (roleToks.length < 2) return false;
  const textToks = new Set(tokens(text));
  const overlap = roleToks.filter((t) => textToks.has(t)).length;
  return overlap >= 2 && overlap >= Math.ceil(roleToks.length / 2);
};

// Capitalized function words that begin a sentence/clause and would otherwise
// pair with the next capitalized word into a spurious "name" (e.g. "The Project",
// "Our Lead"). A name whose first token is one of these is dropped.
const LEADING_STOPWORDS = new Set([
  'the', 'our', 'we', 'this', 'that', 'their', 'his', 'her', 'its', 'your', 'my',
  'a', 'an', 'all', 'each', 'these', 'those', 'both',
]);

/** Sentences/cells that name a plan role AND carry a person name near it. */
const extractTeamCandidates = (
  text: string,
  members: SolutionPlanTeamLine[],
  base: Omit<TeamCandidate, 'item' | 'snippet' | 'statedNames'>,
): TeamCandidate[] => {
  const out: TeamCandidate[] = [];
  const chunks = text.split(/(?<=[.!?])\s+|\s\|\s/);
  for (const chunk of chunks) {
    for (const item of members) {
      if (!mentionsRole(chunk, item.role)) continue;
      // Scan for names in a copy with the role LABEL removed, so a multi-word
      // title ("Project Manager") can't be misread as a competing person and
      // can't fuse with a leading word ("The Project Manager" → "The Project").
      const roleStripped = chunk.replace(new RegExp(escapeRegex(item.role), 'gi'), ' ');
      const names = roleStripped.match(personNameRegex());
      if (!names) continue;
      const planNameLower = item.name.toLowerCase();
      // Keep only names that are a DIFFERENT person than the plan's assignee
      // (the package agreeing is not a contradiction) and that don't begin with a
      // capitalized function word. Nothing left → no dispute → no candidate.
      const others = Array.from(new Set(names.map((n) => norm(n)))).filter((n) => {
        const nl = n.toLowerCase();
        if (nl === planNameLower) return false;
        if (LEADING_STOPWORDS.has(nl.split(' ')[0])) return false;
        return true;
      });
      if (others.length === 0) continue;
      out.push({
        ...base,
        item,
        snippet: norm(chunk).slice(0, 300),
        statedNames: others.join(', '),
      });
    }
  }
  return out;
};

const buildTeamVerifyPrompt = (
  items: Array<{ i: number; role: string; planPerson: string; snippet: string; statedNames: string }>,
) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You verify staffing in a proposal against the company\'s authoritative SOLUTION PLAN team roster. ' +
    'For each item you are given a ROLE, the PERSON the plan assigns to that role, a PASSAGE from the ' +
    'proposal, and the person NAME(S) stated in that passage. Decide whether the passage assigns the ' +
    'SAME role to a DIFFERENT person than the plan does. Only report a genuine staffing contradiction ' +
    'for the SAME role — never a different role, never a mere title/format difference or a nickname/' +
    'abbreviation of the SAME person, and never when you are unsure it is the same role. Return ONLY ' +
    'JSON: { "mismatches": [{ "index": <i>, "stated": "<person in passage>" }, ...] }.',
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
                  `#${it.i} ROLE="${it.role}" planPerson="${it.planPerson}"\n` +
                  `PASSAGE: ${it.snippet}\nSTATED names=${it.statedNames}`,
              )
              .join('\n\n---\n\n') +
            '\n\nReturn only genuine same-role staffing mismatches. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

interface ParsedTeamMismatch {
  index: number;
  stated: string;
}

const parseTeamMismatches = (modelOut: unknown): ParsedTeamMismatch[] => {
  if (!modelOut || typeof modelOut !== 'object') return [];
  const arr = (modelOut as Record<string, unknown>).mismatches;
  if (!Array.isArray(arr)) return [];
  const out: ParsedTeamMismatch[] = [];
  for (const entry of arr) {
    if (entry && typeof entry === 'object') {
      const e = entry as Record<string, unknown>;
      const index = Number(e.index);
      if (Number.isInteger(index)) {
        out.push({ index, stated: typeof e.stated === 'string' ? e.stated : '' });
      }
    }
  }
  return out;
};

const computePlanTeamFindings = async (
  plan: SolutionPlanFacts,
  inventory: PackageInventory,
  modelId: string,
): Promise<RawFinding[]> => {
  const members = plan.teamMembers;
  if (members.length === 0) {
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6c-plan-team', generated: 0, kept: 0 }));
    return [];
  }

  // Stage 1 — gather candidates across HTML docs + questionnaires + forms
  // (mirrors C6a exactly).
  const candidates: TeamCandidate[] = [];

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
            ...extractTeamCandidates(text, members, {
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
        ...extractTeamCandidates(`${norm(field.label ?? '')}: ${value}`, members, {
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
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6c-plan-team', generated: 0, kept: 0 }));
    return [];
  }

  const capped = candidates.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);

  let mismatches: ParsedTeamMismatch[] = [];
  try {
    const promptItems = capped.map((c, i) => ({
      i,
      role: c.item.role,
      planPerson: c.item.name,
      snippet: c.snippet,
      statedNames: c.statedNames,
    }));
    const body = await invokeModel(modelId, JSON.stringify(buildTeamVerifyPrompt(promptItems)));
    const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
    const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
    mismatches = raw ? parseTeamMismatches(safeParseJsonFromModel(String(raw))) : [];
  } catch (err) {
    console.warn('[compliance-review-solution-plan] team verify call failed:', (err as Error)?.message);
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6c-plan-team', generated, kept: 0 }));
    return [];
  }

  const findings: RawFinding[] = [];
  // Suffix the findingId with the emission ordinal so a repeated model index
  // can't produce two findings with the same id (fingerprint dedup handles true
  // duplicates downstream).
  mismatches.forEach((m, emitIdx) => {
    const cand = capped[m.index];
    if (!cand) return;
    // Fallback to the scanned names when the model returns an empty `stated`.
    const statedPerson = m.stated || cand.statedNames;
    findings.push({
      findingId: `solution-plan-team-${cand.documentId}-${m.index}-${emitIdx}`,
      targetKind: cand.targetKind,
      documentId: cand.documentId,
      documentTitle: cand.documentTitle,
      anchor: cand.anchor,
      snippet: cand.snippet,
      issueType: 'SOLUTION_PLAN_MISMATCH',
      severity: 'major',
      title: `Staffing for "${cand.item.role}" does not match the solution plan in "${cand.documentTitle}"`,
      description:
        `The solution plan assigns "${cand.item.role}" to ${cand.item.name}, but this document names ` +
        `"${statedPerson}" for that role. The package must match the latest approved solution plan's team.`,
      suggestion:
        `Update the person named for "${cand.item.role}" in "${cand.documentTitle}" to match the solution ` +
        `plan (${cand.item.name}), or regenerate the team if it has changed.`,
    });
  });

  console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6c-plan-team', generated, kept: findings.length }));
  return findings;
};

// ─── C6d — person→role consistency (assigned person → stated role) ───────────
//
// C6c catches a plan ROLE staffed by a DIFFERENT PERSON. C6d catches the
// transpose: the SAME plan PERSON listed under a DIFFERENT ROLE than the plan
// assigns them (e.g. the plan makes Jane the "Project Manager" but the package
// lists her as "Solution Architect"). Roles are open-vocabulary — there is no
// role regex the way `personNameRegex` bounds names — so Stage 1 anchors on the
// PERSON (a finite plan set) and hands any role-bearing passage to the model,
// which is the precision gate (it reads the stated role out of the snippet).

interface RoleCandidate {
  item: SolutionPlanTeamLine;
  targetKind: RawFinding['targetKind'];
  documentId: string;
  documentTitle: string;
  anchor?: FindingAnchor;
  snippet: string;
}

/**
 * Generic role/title signal — a passage plausibly STATES a role when it carries
 * one of these words. Keeps Stage 1 from turning every narrative mention of a
 * person ("Jane will lead the migration") into a candidate, while staying loose
 * enough to admit any real title ("Frontend Developer", "UX Designer",
 * "Proposed Role: …"). Precision is still the model's job in Stage 2.
 */
const ROLE_HINT_RE =
  /\b(roles?|positions?|titles?|serves?\s+as|assigned\s+as|listed\s+as|developer|engineer|designer|manager|lead|director|architect|analyst|administrator|officer|coordinator|specialist|supervisor|consultant|principal|scientist|strategist|advisor|liaison|owner)\b/i;

/**
 * Whether a passage plausibly NAMES a plan person. Handles the abbreviated
 * surname form the plan roster carries ("Petro T.", "Kateryna P.") that
 * `personNameRegex` cannot match: require every SIGNIFICANT name token (an
 * alphabetic token ≥2 chars, dropping single-letter initials) to appear as a
 * word. Loose on purpose — Stage 2 is the precision gate.
 */
const mentionsName = (text: string, name: string): boolean => {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return false;
  const significant = parts
    .map((p) => p.replace(/\.$/, ''))
    .filter((p) => /^[A-Za-z]{2,}$/.test(p));
  const need = significant.length > 0 ? significant : parts.map((p) => p.replace(/\.$/, ''));
  return need.every((tok) => containsWord(text, tok));
};

/** Passages that name a plan person under a role that is NOT their plan role. */
const extractRoleCandidates = (
  text: string,
  members: SolutionPlanTeamLine[],
  base: Omit<RoleCandidate, 'item' | 'snippet'>,
): RoleCandidate[] => {
  const out: RoleCandidate[] = [];
  const chunks = text.split(/(?<=[.!?])\s+|\s\|\s/);
  for (const chunk of chunks) {
    // A role must plausibly be stated at all, or there is nothing to contradict.
    if (!ROLE_HINT_RE.test(chunk)) continue;
    for (const item of members) {
      if (!mentionsName(chunk, item.name)) continue;
      // The package agrees when the chunk already states the person's OWN plan
      // role → no dispute → skip (mirrors C6c dropping the plan assignee).
      if (mentionsRole(chunk, item.role)) continue;
      out.push({ ...base, item, snippet: norm(chunk).slice(0, 300) });
    }
  }
  return out;
};

const buildRoleVerifyPrompt = (
  items: Array<{ i: number; person: string; planRole: string; snippet: string }>,
) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You verify staffing in a proposal against the company\'s authoritative SOLUTION PLAN team roster. ' +
    'For each item you are given a PERSON, the ROLE the plan assigns that person, and a PASSAGE from the ' +
    'proposal that mentions the person. Decide whether the passage assigns the SAME person to a DIFFERENT ' +
    'role/title than the plan does. Only report a genuine role contradiction for the SAME person — never a ' +
    'different person, never a mere title/format variant, seniority prefix, or a broader/narrower phrasing ' +
    'of the SAME role, and never when the passage states no role for the person or you are unsure. When you ' +
    'do report one, copy the role STATED in the passage into "stated". Return ONLY JSON: ' +
    '{ "mismatches": [{ "index": <i>, "stated": "<role in passage>" }, ...] }.',
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
                  `#${it.i} PERSON="${it.person}" planRole="${it.planRole}"\n` + `PASSAGE: ${it.snippet}`,
              )
              .join('\n\n---\n\n') +
            '\n\nReturn only genuine same-person role mismatches. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

const computePlanRoleFindings = async (
  plan: SolutionPlanFacts,
  inventory: PackageInventory,
  modelId: string,
): Promise<RawFinding[]> => {
  const members = plan.teamMembers;
  if (members.length === 0) {
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6d-plan-role', generated: 0, kept: 0 }));
    return [];
  }

  // Stage 1 — gather candidates across HTML docs + questionnaires + forms
  // (mirrors C6a/C6c exactly).
  const candidates: RoleCandidate[] = [];

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
            ...extractRoleCandidates(text, members, {
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
        ...extractRoleCandidates(`${norm(field.label ?? '')}: ${value}`, members, {
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
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6d-plan-role', generated: 0, kept: 0 }));
    return [];
  }

  const capped = candidates.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);

  let mismatches: ParsedTeamMismatch[] = [];
  try {
    const promptItems = capped.map((c, i) => ({
      i,
      person: c.item.name,
      planRole: c.item.role,
      snippet: c.snippet,
    }));
    const body = await invokeModel(modelId, JSON.stringify(buildRoleVerifyPrompt(promptItems)));
    const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
    const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
    // Same { index, stated } shape as C6c → reuse the C6c parser.
    mismatches = raw ? parseTeamMismatches(safeParseJsonFromModel(String(raw))) : [];
  } catch (err) {
    console.warn('[compliance-review-solution-plan] role verify call failed:', (err as Error)?.message);
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6d-plan-role', generated, kept: 0 }));
    return [];
  }

  const findings: RawFinding[] = [];
  // Suffix the findingId with the emission ordinal so a repeated model index
  // can't produce two findings with the same id (fingerprint dedup handles true
  // duplicates downstream).
  mismatches.forEach((m, emitIdx) => {
    const cand = capped[m.index];
    if (!cand) return;
    const statedRole = m.stated || '(a different role)';
    findings.push({
      findingId: `solution-plan-role-${cand.documentId}-${m.index}-${emitIdx}`,
      targetKind: cand.targetKind,
      documentId: cand.documentId,
      documentTitle: cand.documentTitle,
      anchor: cand.anchor,
      snippet: cand.snippet,
      issueType: 'SOLUTION_PLAN_MISMATCH',
      severity: 'major',
      title: `Role for ${cand.item.name} does not match the solution plan in "${cand.documentTitle}"`,
      description:
        `The solution plan assigns ${cand.item.name} to "${cand.item.role}", but this document lists ` +
        `them as "${statedRole}". The package must match the latest approved solution plan's team.`,
      suggestion:
        `Update the role for ${cand.item.name} in "${cand.documentTitle}" to match the solution plan ` +
        `("${cand.item.role}"), or regenerate the team if it has changed.`,
    });
  });

  console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C6d-plan-role', generated, kept: findings.length }));
  return findings;
};

// ─── Public entry point ──────────────────────────────────────────────────────

export const computeSolutionPlanFindings = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  modelId: string;
  inventory: PackageInventory;
}): Promise<RawFinding[]> => {
  try {
    const { orgId, projectId, oppId, modelId, inventory } = args;
    const plan = await loadSolutionPlanFacts(orgId, projectId, oppId);
    if (!plan) return []; // no READY plan → nothing to check against
    const [cost, prose, team, role] = await Promise.all([
      computePlanCostFindings(plan, inventory, modelId),
      computePlanProseFindings(plan, inventory, modelId),
      computePlanTeamFindings(plan, inventory, modelId),
      computePlanRoleFindings(plan, inventory, modelId),
    ]);
    return [...cost, ...prose, ...team, ...role];
  } catch (err) {
    console.warn('[compliance-review-solution-plan] check failed:', (err as Error)?.message);
    return [];
  }
};
