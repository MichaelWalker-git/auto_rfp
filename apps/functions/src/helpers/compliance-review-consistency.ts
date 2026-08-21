/**
 * Canonical-value consistency cross-check (full review only).
 *
 * The LLM review reads only a SAMPLE of document sections (bounded tool rounds),
 * so "is the company name consistent everywhere?" is unreliable — an inconsistent
 * value in an unread section (e.g. a large questionnaire) is missed, with nothing
 * to audit. This adds a targeted cross-check for canonical values:
 *
 *   - COMPANY NAME (fuzzy): deterministically extract every name-like phrase from
 *     all docs, then ONE cheap model call groups which are renderings of the
 *     canonical entity. Docs whose rendering differs from canonical → INCONSISTENCY.
 *     (Name matching is inherently fuzzy — "HORUSTECH", "HorusTech", "Horus
 *     Technology" all mean the same entity — so a pure string rule either misses
 *     variants or over-flags. The model does the grouping; code does the flagging.)
 *   - IDENTIFIERS (exact): UEI / CAGE / EIN — deterministic. If a doc references
 *     the identifier's label but not the canonical value, flag it.
 *
 * Token/time-safe: the ONE model call is over a short list of extracted phrases
 * (not the package text), in the 15-min worker (not the 29s path). Best-effort:
 * any failure returns `[]` so the review never fails.
 *
 * Canonical name is HYBRID: profile (dba → legalEntityName → companyName), else
 * the dominant name-like phrase appearing across multiple docs.
 */
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { getCompanyProfile } from '@/helpers/company-profile';
import { loadInventoryDocHtml } from '@/helpers/compliance-review-doc-cache';
import { stripHtml } from '@/helpers/compliance-review-html';
import {
  MAX_FACTUAL_CANDIDATES_PER_CHECK,
  MAX_TOKENS_FACTUAL,
} from '@/constants/compliance-review';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';
import type { FindingAnchor } from '@auto-rfp/core';
import { norm, escapeRegex, tokens, containsWord } from '@/helpers/compliance-review-text';

// Re-export so existing importers (e.g. compliance-review-solution-plan) keep a
// stable path while the primitive now lives in compliance-review-text.
export { containsWord };

// ─── Candidate name-phrase extraction (deterministic) ─────────────────────────

// Capitalized / ALLCAPS / CamelCase multi-token runs — the shape company names
// take. Bounded length; deduped by the caller.
const NAME_PHRASE_RE =
  /[A-Z][A-Za-z0-9&.'-]*(?:\s+(?:[A-Z][A-Za-z0-9&.'-]*|of|and|the|DBA|dba)){0,7}/g;

/** Distinct name-like phrases in a text (trimmed, length-bounded). */
export const extractNamePhrases = (text: string): string[] => {
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  NAME_PHRASE_RE.lastIndex = 0;
  while ((m = NAME_PHRASE_RE.exec(text)) !== null) {
    const phrase = norm(m[0]);
    if (phrase.length >= 3 && phrase.length <= 80) out.add(phrase);
  }
  return Array.from(out);
};

/**
 * Dominant name phrase across MULTIPLE docs (used as canonical when the profile
 * has no name). Counts distinct-doc appearances so a one-off phrase isn't picked.
 */
const dominantAcrossDocs = (phrasesPerDoc: string[][]): string | null => {
  const docCount = new Map<string, number>();
  for (const phrases of phrasesPerDoc) {
    for (const p of new Set(phrases)) {
      if (p.split(' ').length < 2) continue; // multi-word only
      docCount.set(p, (docCount.get(p) ?? 0) + 1);
    }
  }
  const multi = [...docCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
  return multi.length > 0 ? multi[0][0] : null;
};

// ─── Model grouping: which phrases are renderings of the canonical? ───────────

const buildGroupingPrompt = (canonical: string, phrases: string[]) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You group company-name renderings. Given a CANONICAL company name and a list of ' +
    'candidate phrases, return ONLY the phrases that refer to the SAME company/entity as ' +
    'the canonical (including abbreviations, acronyms, case/spacing/punctuation variants, ' +
    'and partial forms), EXCLUDING any phrase written EXACTLY as the canonical. Never ' +
    'include an unrelated company. Return ONLY JSON: { "variants": ["<phrase>", ...] }.',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `CANONICAL: "${canonical}"\n\nCANDIDATE PHRASES:\n` +
            phrases.map((p) => `- ${p}`).join('\n') +
            '\n\nReturn the phrases that are alternate renderings of the canonical entity ' +
            '(not written exactly as the canonical). JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: 2000,
});

const parseVariants = (modelOut: unknown): string[] => {
  if (!modelOut || typeof modelOut !== 'object') return [];
  const v = (modelOut as Record<string, unknown>).variants;
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? norm(x) : '')).filter(Boolean);
};

/** One model call: the set of phrases that are non-canonical renderings of the entity. */
const groupNameVariants = async (
  canonical: string,
  phrases: string[],
  modelId: string,
): Promise<Set<string>> => {
  const canonNorm = norm(canonical);
  const candidates = phrases.filter((p) => p !== canonNorm);
  if (candidates.length === 0) return new Set();
  try {
    const body = await invokeModel(modelId, JSON.stringify(buildGroupingPrompt(canonNorm, candidates)));
    const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
    const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
    const variants = raw ? parseVariants(safeParseJsonFromModel(String(raw))) : [];
    // Only trust variants that were actually in our candidate list (no hallucinated strings).
    const candidateSet = new Set(candidates);
    return new Set(variants.filter((v) => candidateSet.has(v) && v !== canonNorm));
  } catch (err) {
    console.warn('[compliance-review-consistency] name grouping call failed:', (err as Error)?.message);
    return new Set();
  }
};

// ─── Identifier consistency (exact-match, deterministic) ──────────────────────

interface CanonicalIdentifier {
  label: string;
  value: string;
}

/**
 * Presence test for a formatted IDENTIFIER value (UEI / CAGE / EIN), tolerant of
 * separator and whitespace differences. Federal identifiers are written with
 * varying punctuation — a canonical EIN "12-3456789" appears in documents as
 * "123456789" or "12 3456789" — so a literal whole-word match false-positives on
 * pure formatting and reports a consistent value as inconsistent.
 *
 * We match the value's ALPHANUMERIC groups in order, allowing any run of non-alnum
 * separators (including none) between them, and anchor with alphanumeric
 * lookarounds so the match can't land INSIDE a longer token (e.g. the 9-digit EIN
 * must not be counted "present" inside a 10-digit phone number).
 */
export const containsIdentifierValue = (haystack: string, value: string): boolean => {
  // Reduce the value to its alphanumeric characters, then allow any run of
  // non-alnum separators (or none) BETWEEN each character. This is symmetric:
  // it matches whether the separator lives in the canonical value or the doc
  // ("12-3456789" ↔ "123456789" ↔ "12 3456789"). Alnum lookarounds anchor the
  // match so it can't land inside a longer token (e.g. a 10-digit phone number).
  const alnum = value.replace(/[^A-Za-z0-9]/g, '');
  if (!alnum) return false;
  const pattern = alnum.split('').map(escapeRegex).join('[^A-Za-z0-9]*');
  return new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, 'i').test(haystack);
};

/**
 * The identifier's uppercase LABEL is present as a whole word (case-sensitive),
 * but the canonical value is absent (separator-tolerant, case-insensitive) →
 * likely a mismatch worth verifying.
 */
const identifierMissingNearLabel = (text: string, label: string, value: string): boolean =>
  containsWord(text, label, true) && !containsIdentifierValue(text, value);

// ─── Public entry point ────────────────────────────────────────────────────────

export const computeConsistencyFindings = async (args: {
  orgId: string;
  modelId: string;
  inventory: PackageInventory;
}): Promise<RawFinding[]> => {
  try {
    const { orgId, modelId, inventory } = args;
    // Scan HTML documents AND file-based XLSX questionnaires (their content lives
    // in questionnaireCells, not HTML) — otherwise a name/identifier inconsistency
    // inside a questionnaire's cells would be missed.
    const docs = inventory.documents.filter((d) => d.htmlContentKey || d.questionnaireCells);
    const forms = inventory.forms;
    // Nothing to scan → nothing to flag. Forms alone are enough to run (a package
    // can be all forms), so only bail when BOTH docs and forms are empty.
    if (docs.length === 0 && forms.length === 0) return [];

    // Load each doc's plain text once: HTML → stripped text; XLSX questionnaire →
    // its cell values joined.
    const texts = new Map<string, string>();
    await Promise.all(
      docs.map(async (d) => {
        try {
          if (d.htmlContentKey) {
            texts.set(d.documentId, norm(stripHtml(await loadInventoryDocHtml(inventory, d.htmlContentKey))));
          } else if (d.questionnaireCells) {
            // Join cells with a delimiter that BREAKS phrase runs — cells are
            // distinct content units, so a value like "HORUSTECH" in its own cell
            // must not glue to the neighbouring cell's capitalized word.
            texts.set(
              d.documentId,
              d.questionnaireCells.cells.map((c) => norm(c.value)).filter(Boolean).join(' | '),
            );
          } else {
            texts.set(d.documentId, '');
          }
        } catch {
          texts.set(d.documentId, '');
        }
      }),
    );

    // Forms are field-based, not text blobs. Build a per-form scan text by
    // joining each field's "label: value" with the same phrase-BREAKING delimiter
    // used for questionnaire cells, so values in separate fields never glue into a
    // false multi-word name. Keep the fields alongside so a flagged variant can be
    // anchored to the specific field whose VALUE contains it.
    const formScan = forms.map((form) => ({
      form,
      text: norm(
        form.fields
          .map((f) => `${f.label ?? ''}: ${f.value ?? ''}`.trim())
          .filter(Boolean)
          .join(' | '),
      ),
    }));

    const profile = await getCompanyProfile(orgId).catch(() => null);
    const findings: RawFinding[] = [];

    // ── Company name (model-assisted grouping) ──
    const phrasesPerDoc = docs.map((d) => extractNamePhrases(texts.get(d.documentId) ?? ''));
    const phrasesPerForm = formScan.map((f) => extractNamePhrases(f.text));
    let canonicalName = norm(profile?.dba || profile?.legalEntityName || profile?.companyName || '') || null;
    // Dominant-name fallback considers docs AND forms so an all-forms package still
    // has a canonical to compare against.
    if (!canonicalName) canonicalName = dominantAcrossDocs([...phrasesPerDoc, ...phrasesPerForm]);

    if (canonicalName) {
      const canonNorm = norm(canonicalName);
      // ONE grouping call over the whole candidate set (docs + forms) — no extra
      // model calls for adding form coverage.
      const allPhrases = Array.from(new Set([...phrasesPerDoc.flat(), ...phrasesPerForm.flat()]));
      const variantSet = await groupNameVariants(canonNorm, allPhrases, modelId);
      if (variantSet.size > 0) {
        docs.forEach((d, i) => {
          const docVariants = Array.from(new Set(phrasesPerDoc[i])).filter((p) => variantSet.has(p));
          if (docVariants.length === 0) return;
          findings.push({
            findingId: `consistency-name-${d.documentId}`,
            // `docs` includes XLSX questionnaires, so use the doc's real kind
            // (mirrors the form loop's form.targetKind) — hardcoding RFP_DOCUMENT
            // mislabels questionnaire findings and triggers a no-op HTML lookup.
            targetKind: d.targetKind,
            documentId: d.documentId,
            documentTitle: d.title,
            issueType: 'INCONSISTENCY',
            severity: 'major',
            snippet: docVariants[0],
            title: `Company name inconsistent in "${d.title}"`,
            description:
              `This document uses ${docVariants.map((v) => `"${v}"`).join(', ')} for the company name, ` +
              `which differs from the standard "${canonNorm}" used elsewhere in the package.`,
            suggestion: `Replace ${docVariants.map((v) => `"${v}"`).join(', ')} with "${canonNorm}".`,
          });
        });

        // Form fields: anchor each flagged variant to the field whose VALUE
        // contains it, so the finding lands on the exact form field in the UI.
        formScan.forEach(({ form }, i) => {
          const formVariants = Array.from(new Set(phrasesPerForm[i])).filter((p) => variantSet.has(p));
          if (formVariants.length === 0) return;
          for (const field of form.fields) {
            const value = field.value ?? '';
            // Variants come from norm()'d scan text (internal whitespace collapsed),
            // so match against the normalized value too — otherwise a field like
            // "Horus  Technology" (double space) wouldn't contain "Horus Technology"
            // and a genuine inconsistency would be silently dropped.
            const normValue = norm(value);
            const hit = formVariants.filter((v) => normValue.includes(v));
            if (hit.length === 0) continue;
            findings.push({
              findingId: `consistency-name-form-${form.formId}-${field.fieldId}`,
              targetKind: form.targetKind,
              documentId: form.formId,
              documentTitle: form.name,
              anchor: { kind: 'field', fieldId: field.fieldId },
              issueType: 'INCONSISTENCY',
              severity: 'major',
              snippet: hit[0],
              title: `Company name inconsistent in "${form.name}"`,
              description:
                `The field "${field.label}" uses ${hit.map((v) => `"${v}"`).join(', ')} for the company name, ` +
                `which differs from the standard "${canonNorm}" used elsewhere in the package.`,
              suggestion: `Replace ${hit.map((v) => `"${v}"`).join(', ')} with "${canonNorm}".`,
            });
          }
        });
      }
    }

    // ── Identifiers (exact, deterministic) ──
    if (profile) {
      const identifiers: CanonicalIdentifier[] = [
        profile.uei ? { label: 'UEI', value: profile.uei } : null,
        profile.cage ? { label: 'CAGE', value: profile.cage } : null,
        profile.ein ? { label: 'EIN', value: profile.ein } : null,
      ].filter((x): x is CanonicalIdentifier => !!x && !!x.value.trim());

      for (const id of identifiers) {
        for (const d of docs) {
          const text = texts.get(d.documentId) ?? '';
          if (text && identifierMissingNearLabel(text, id.label, id.value)) {
            findings.push({
              findingId: `consistency-${id.label.toLowerCase()}-${d.documentId}`,
              // `docs` includes XLSX questionnaires — use the doc's real kind, not
              // a hardcoded RFP_DOCUMENT (same bug as the name pass above).
              targetKind: d.targetKind,
              documentId: d.documentId,
              documentTitle: d.title,
              issueType: 'INCONSISTENCY',
              severity: 'minor',
              title: `${id.label} may be inconsistent in "${d.title}"`,
              description:
                `This document mentions ${id.label} but does not contain the company's ${id.label} ` +
                `"${id.value}". Verify the ${id.label} value here matches the company record.`,
              suggestion: `Confirm the ${id.label} in "${d.title}" is "${id.value}".`,
            });
          }
        }

        // Form fields: a field whose LABEL names the identifier but whose VALUE
        // isn't the canonical one is likely a stale/wrong identifier. Anchor to
        // that field.
        for (const form of forms) {
          for (const field of form.fields) {
            const value = field.value ?? '';
            const labelNamesId = containsWord(field.label ?? '', id.label, true);
            if (labelNamesId && value.trim() && !containsIdentifierValue(value, id.value)) {
              findings.push({
                findingId: `consistency-${id.label.toLowerCase()}-form-${form.formId}-${field.fieldId}`,
                targetKind: form.targetKind,
                documentId: form.formId,
                documentTitle: form.name,
                anchor: { kind: 'field', fieldId: field.fieldId },
                issueType: 'INCONSISTENCY',
                severity: 'minor',
                title: `${id.label} may be inconsistent in "${form.name}"`,
                description:
                  `The field "${field.label}" names ${id.label} but its value does not match the company's ${id.label} ` +
                  `"${id.value}". Verify the ${id.label} value here matches the company record.`,
                suggestion: `Confirm the ${id.label} in "${form.name}" is "${id.value}".`,
              });
            }
          }
        }
      }
    }

    return findings;
  } catch (err) {
    console.warn('[compliance-review-consistency] cross-check failed:', (err as Error)?.message);
    return [];
  }
};

// ─── C1 — Profile identity fields (two-stage) ────────────────────────────────
//
// Extends the identity coverage of `computeConsistencyFindings` beyond the
// name/UEI/CAGE/EIN it already handles. Two families of fields:
//   - Deterministic-exact (high confidence): primaryNaics — fires ONLY when a
//     value of the fact's shape (a 6-digit NAICS code) that DIFFERS from the
//     canonical one actually appears near the label. The label alone ("NAICS
//     codes are listed in the attached forms") is not enough — that over-flags
//     cover pages. A competing concrete code is near-certain drift, so it emits
//     directly with no Stage-2 model call.
//   - Prose (Stage-2 verify): zip, address, city, state, entityType,
//     authorizedSignatory.name — these appear in free text where a naive match
//     over-flags (e.g. "LLC" in a legal clause, or "zip file"/"zip code" for the
//     ZIP label), so Stage 1 only generates candidate spots near a label and the
//     model confirms the genuine mismatch.
//
// FR-3: this NEVER re-flags the name/UEI/CAGE/EIN spots the existing pass covers
// — those fact types are simply not among the ones scanned here.

interface ProfileFact {
  factType: string;
  /** Human label used in the label-proximity generator + the finding text. */
  label: string;
  /** The canonical value from the profile. */
  canonical: string;
  /** Exact deterministic match, or prose (needs Stage-2 verify). */
  mode: 'exact' | 'prose';
  /**
   * REQUIRED for `exact` facts: the shape of the value in text (e.g. a 6-digit
   * NAICS). The exact path only fires when a value of THIS shape — differing from
   * the canonical — actually appears; the label alone is NOT enough. This is what
   * makes the direct (no-Stage-2) emit trustworthy: "NAICS codes are in the
   * attached forms" (label, no code) is not a drift, but "NAICS 541511" (label +
   * a competing code) is. Global (`/g`) so we can scan every occurrence.
   */
  valueShape?: RegExp;
}

/**
 * How close (in characters) a value-shaped token must sit to a label occurrence
 * to count as drift on the whole-document path. Without this, the deterministic
 * exact path scanned the ENTIRE document for any value of the fact's shape, so a
 * doc merely mentioning "NAICS" plus any unrelated 6-digit run — a comma-less
 * dollar amount ("$500000"), a control number ("DOC-100234"), a yearmonth
 * ("202412") — produced a spurious `major` finding. Requiring the competing
 * value NEAR the label is what the design comment (and the finding text) promise.
 */
const EXACT_LABEL_PROXIMITY = 60;

/**
 * For an `exact` fact, find a value-shaped token in the text that DIFFERS from
 * the canonical value — the concrete "competing value" that turns a bare label
 * mention into genuine drift. Returns the differing value (for the finding text)
 * or null when the only value-shaped tokens present ARE the canonical one (or
 * none appear at all).
 *
 * `proximityLabel` constrains matching to value-shaped tokens that appear within
 * `EXACT_LABEL_PROXIMITY` characters of a label occurrence — required on the
 * whole-document path so an unrelated 6-digit run elsewhere in the doc is not
 * mistaken for a competing value. Omit it when `text` is ALREADY scoped to the
 * fact (e.g. a form field's own value), where every token is on-topic.
 */
const findExactDrift = (text: string, fact: ProfileFact, proximityLabel?: string): string | null => {
  if (!fact.valueShape) return null;
  const canon = norm(fact.canonical).toLowerCase();
  // Collect label occurrences once (case-insensitive) for the proximity test.
  let labelSpans: Array<[number, number]> | null = null;
  if (proximityLabel) {
    labelSpans = [];
    const labelRe = new RegExp(`\\b${escapeRegex(proximityLabel)}\\b`, 'gi');
    let lm: RegExpExecArray | null;
    while ((lm = labelRe.exec(text)) !== null) {
      labelSpans.push([lm.index, lm.index + lm[0].length]);
      if (labelRe.lastIndex === lm.index) labelRe.lastIndex++;
    }
    if (labelSpans.length === 0) return null; // label not present as a whole word
  }
  const re = new RegExp(fact.valueShape.source, fact.valueShape.flags.includes('g') ? fact.valueShape.flags : `${fact.valueShape.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const found = norm(m[0]);
    const advance = () => {
      if (re.lastIndex === m!.index) re.lastIndex++; // guard against zero-width stall
    };
    if (found.toLowerCase() === canon) {
      advance();
      continue;
    }
    if (labelSpans) {
      const near = labelSpans.some(
        ([ls, le]) => m!.index <= le + EXACT_LABEL_PROXIMITY && m!.index + m![0].length >= ls - EXACT_LABEL_PROXIMITY,
      );
      if (!near) {
        advance();
        continue;
      }
    }
    return found;
  }
  return null;
};

/** Label tokens whose presence near a differing value makes a prose candidate. */
const PROSE_LABELS: Record<string, string[]> = {
  address: ['address', 'street'],
  city: ['city'],
  state: ['state'],
  // "zip" is a common English word ("zip file", "zip code" in boilerplate), so
  // the bare-label match over-flags on the exact path. Route it through Stage 2:
  // the label seeds a candidate, the model confirms a genuine ZIP contradiction.
  zip: ['zip', 'zip code', 'postal code', 'postal'],
  entityType: ['entity', 'organization type', 'business type', 'incorporated', 'llc', 'inc', 'corporation'],
  'authorizedSignatory.name': ['signature', 'signatory', 'authorized', 'name', 'title', 'printed name'],
};

interface FactCandidate {
  fact: ProfileFact;
  targetKind: RawFinding['targetKind'];
  documentId: string;
  documentTitle: string;
  anchor?: FindingAnchor;
  found: string;
  snippet: string;
}

/**
 * An abbreviation-shaped value — a short all-caps run such as a 2-letter state
 * code ("IN", "OR", "ME", "OK", "OH", "HI") or a legal-entity suffix ("LLC",
 * "INC") — collides with ordinary English words under a case-insensitive match,
 * so it MUST be matched case-sensitively and whole-word, exactly as for the
 * UEI/CAGE/EIN identifiers (see `containsWord`). Otherwise canonical "IN" reads
 * as present in nearly every document, `proseCandidateSnippet` short-circuits,
 * and a genuinely wrong state is silently never surfaced.
 */
const isAbbreviationShaped = (v: string): boolean => /^[A-Z]{2,5}$/.test(norm(v));

const containsCanonical = (text: string, canonical: string): boolean => {
  const c = norm(canonical);
  // Abbreviation-shaped → case-sensitive whole-word only; the loose substring
  // fallback below is what makes "IN" match "training"/"in"/"during".
  if (isAbbreviationShaped(c)) return containsWord(text, c, true);
  return containsWord(text, c) || text.toLowerCase().includes(c.toLowerCase());
};


/**
 * Index of the first WHOLE-WORD occurrence of `label` in `text` (case-insensitive),
 * or -1. Word-bounded like `containsWord` — a bare `indexOf` over-generated Stage-2
 * candidates because short labels match inside unrelated words ("inc" in
 * "province"/"since", "name" in "filename", "state" in "statement"), and each
 * spurious hit costs a model item and can crowd out real ones under the candidate cap.
 */
const wholeWordIndex = (text: string, label: string): number => {
  const n = label.trim();
  if (!n) return -1;
  const m = new RegExp(`\\b${escapeRegex(n)}\\b`, 'i').exec(text);
  return m ? m.index : -1;
};

/**
 * A prose candidate exists when the field's label (or a partial token of the
 * canonical value) appears in the text but the canonical value itself does NOT —
 * a spot that MIGHT state a different value for this fact. Loose on purpose
 * (Stage 2 is the precision gate), but label matching is WHOLE-WORD so short
 * label tokens don't match inside unrelated words.
 */
const proseCandidateSnippet = (text: string, fact: ProfileFact): string | null => {
  if (containsCanonical(text, fact.canonical)) return null; // value present → consistent
  const labels = PROSE_LABELS[fact.factType] ?? [fact.label.toLowerCase()];
  let hitIdx = -1;
  for (const label of labels) {
    const idx = wholeWordIndex(text, label);
    if (idx >= 0) {
      hitIdx = idx;
      break;
    }
  }
  if (hitIdx < 0) {
    // Partial token overlap with the canonical value (e.g. the street name
    // without the suite) is a weaker signal but still a candidate.
    const canonToks = tokens(fact.canonical);
    const textToks = new Set(tokens(text));
    if (!canonToks.some((t) => textToks.has(t))) return null;
    hitIdx = 0;
  }
  const start = Math.max(0, hitIdx - 40);
  return norm(text.slice(start, start + 200));
};

const buildFactVerifyPrompt = (items: Array<{ i: number; label: string; canonical: string; passage: string }>) => ({
  anthropic_version: 'bedrock-2023-05-31',
  system:
    'You verify company identity facts. For each item you are given a FIELD label, the CANONICAL ' +
    'value from the company profile, and a PASSAGE from a proposal document. Return ONLY the indices ' +
    'where the passage states a value for THAT SAME field that genuinely CONTRADICTS the canonical ' +
    'value (a real factual mismatch). Ignore passages that do not actually state the field, that ' +
    'match the canonical value, or that merely use a word (e.g. "LLC") in unrelated boilerplate. ' +
    'Return ONLY JSON: { "mismatches": [{ "index": <i>, "found": "<the differing value in the passage>" }, ...] }.',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'ITEMS:\n' +
            items
              .map((it) => `#${it.i} FIELD="${it.label}" CANONICAL="${it.canonical}"\nPASSAGE: ${it.passage}`)
              .join('\n\n') +
            '\n\nReturn only the genuine contradictions. JSON only.',
        },
      ],
    },
  ],
  temperature: 0,
  max_tokens: MAX_TOKENS_FACTUAL,
});

const parseMismatches = (modelOut: unknown): Map<number, string> => {
  const out = new Map<number, string>();
  if (!modelOut || typeof modelOut !== 'object') return out;
  const arr = (modelOut as Record<string, unknown>).mismatches;
  if (!Array.isArray(arr)) return out;
  for (const entry of arr) {
    if (entry && typeof entry === 'object') {
      const i = Number((entry as Record<string, unknown>).index);
      const found = (entry as Record<string, unknown>).found;
      if (Number.isInteger(i)) out.set(i, typeof found === 'string' ? found : '');
    }
  }
  return out;
};

const buildProfileFacts = (profile: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  primaryNaics?: string | null;
  entityType?: string | null;
  authorizedSignatory?: { name: string } | null;
}): ProfileFact[] => {
  const facts: ProfileFact[] = [];
  const add = (
    factType: string,
    label: string,
    value: string | null | undefined,
    mode: ProfileFact['mode'],
    valueShape?: RegExp,
  ) => {
    const v = norm(value ?? '');
    if (v) facts.push({ factType, label, canonical: v, mode, valueShape });
  };
  // NAICS stays on the deterministic (no-Stage-2) path, but only fires when a
  // real 6-digit code — differing from the canonical — is present. The label
  // alone ("NAICS codes are listed in the attached forms") is NOT drift.
  add('primaryNaics', 'NAICS', profile.primaryNaics, 'exact', /\b\d{6}\b/);
  // ZIP is prose (model-verified), not exact: "zip" is a common English word,
  // so a bare-label match with no Stage-2 gate false-positives on boilerplate
  // like "zip file". NAICS stays exact — a 6-digit code rarely appears sans value.
  add('zip', 'ZIP', profile.zip, 'prose');
  add('address', 'Address', profile.address, 'prose');
  add('city', 'City', profile.city, 'prose');
  add('state', 'State', profile.state, 'prose');
  add('entityType', 'Entity type', profile.entityType, 'prose');
  add('authorizedSignatory.name', 'Authorized signatory', profile.authorizedSignatory?.name, 'prose');
  return facts;
};

/**
 * Build the plain scan text for every doc + form (mirrors the delimiter logic in
 * `computeConsistencyFindings`), keyed by documentId. Returns the text map plus
 * the doc/form metadata needed to anchor findings.
 */
const loadScanText = async (
  inventory: PackageInventory,
): Promise<Map<string, { text: string; targetKind: RawFinding['targetKind']; title: string }>> => {
  const map = new Map<string, { text: string; targetKind: RawFinding['targetKind']; title: string }>();
  await Promise.all(
    inventory.documents
      .filter((d) => d.htmlContentKey || d.questionnaireCells)
      .map(async (d) => {
        try {
          if (d.htmlContentKey) {
            map.set(d.documentId, {
              text: norm(stripHtml(await loadInventoryDocHtml(inventory, d.htmlContentKey))),
              targetKind: d.targetKind,
              title: d.title,
            });
          } else if (d.questionnaireCells) {
            map.set(d.documentId, {
              text: d.questionnaireCells.cells.map((c) => norm(c.value)).filter(Boolean).join(' | '),
              targetKind: d.targetKind,
              title: d.title,
            });
          }
        } catch {
          /* skip unreadable doc */
        }
      }),
  );
  return map;
};

/**
 * C1 identity-field factual check. The deterministic-exact field (NAICS) emits
 * directly; prose fields (zip, address, city, state, entityType, signatory)
 * collect candidates that ONE batched model call confirms. Best-effort → `[]`
 * on failure. Emits `FACTUAL_INACCURACY` / `major`.
 */
export const computeProfileFactFindings = async (args: {
  orgId: string;
  modelId: string;
  inventory: PackageInventory;
}): Promise<RawFinding[]> => {
  try {
    const { orgId, modelId, inventory } = args;
    const profile = await getCompanyProfile(orgId).catch(() => null);
    if (!profile) return [];

    const facts = buildProfileFacts(profile);
    if (facts.length === 0) return [];

    const scan = await loadScanText(inventory);
    const findings: RawFinding[] = [];
    const proseCandidates: FactCandidate[] = [];
    let generated = 0;

    // Per-doc scan.
    for (const [documentId, { text, targetKind, title }] of scan) {
      if (!text) continue;
      for (const fact of facts) {
        if (fact.mode === 'exact') {
          // Drift requires BOTH the label AND a competing value of the fact's
          // shape (e.g. a 6-digit NAICS ≠ canonical). The label alone — "NAICS
          // codes are listed in the attached forms" — is NOT a finding.
          const labelPresent = containsWord(text, fact.label, true) || containsWord(text, fact.label, false);
          // Whole-doc scan → require the competing value NEAR a label occurrence,
          // not just anywhere in the document (an unrelated 6-digit run — a
          // comma-less dollar amount, control number, or yearmonth — is not drift).
          const drift =
            labelPresent && !containsCanonical(text, fact.canonical) ? findExactDrift(text, fact, fact.label) : null;
          if (drift) {
            generated += 1;
            findings.push({
              findingId: `profile-fact-${fact.factType}-${documentId}`,
              targetKind,
              documentId,
              documentTitle: title,
              issueType: 'FACTUAL_INACCURACY',
              severity: 'major',
              title: `${fact.label} may not match the company profile in "${title}"`,
              description:
                `This document states a ${fact.label} of "${drift}", but the company profile's ` +
                `${fact.label} is "${fact.canonical}". Verify the value here matches the company record.`,
              suggestion: `Confirm the ${fact.label} in "${title}" is "${fact.canonical}".`,
            });
          }
        } else {
          const snippet = proseCandidateSnippet(text, fact);
          if (snippet) {
            generated += 1;
            proseCandidates.push({ fact, targetKind, documentId, documentTitle: title, found: '', snippet });
          }
        }
      }
    }

    // Form fields: exact + prose candidates anchored to the field.
    for (const form of inventory.forms) {
      for (const field of form.fields) {
        const value = norm(field.value ?? '');
        const label = norm(field.label ?? '');
        if (!value) continue;
        for (const fact of facts) {
          const labels = PROSE_LABELS[fact.factType] ?? [fact.label.toLowerCase()];
          // Whole-word label match (not substring) so a short label token like
          // "name"/"inc" doesn't match inside "Filename"/"Province" field labels.
          const labelNamesFact =
            containsWord(label, fact.label, false) || labels.some((l) => containsWord(label, l, false));
          if (!labelNamesFact) continue;
          if (containsCanonical(value, fact.canonical)) continue;
          const anchor: FindingAnchor = { kind: 'field', fieldId: field.fieldId };
          if (fact.mode === 'exact') {
            // Same rule as the doc scan: a value-shaped token (≠ canonical) must
            // actually be in the field. A NAICS field reading "See attachment"
            // is not drift — only a competing 6-digit code is.
            const drift = findExactDrift(value, fact);
            if (!drift) continue;
            generated += 1;
            findings.push({
              findingId: `profile-fact-${fact.factType}-form-${form.formId}-${field.fieldId}`,
              targetKind: form.targetKind,
              documentId: form.formId,
              documentTitle: form.name,
              anchor,
              issueType: 'FACTUAL_INACCURACY',
              severity: 'major',
              title: `${fact.label} may not match the company profile in "${form.name}"`,
              description:
                `The field "${field.label}" states a ${fact.label} of "${drift}", but the company ` +
                `profile's ${fact.label} is "${fact.canonical}". Verify the value here matches the company record.`,
              suggestion: `Confirm the ${fact.label} in "${form.name}" is "${fact.canonical}".`,
            });
          } else {
            generated += 1;
            proseCandidates.push({
              fact,
              targetKind: form.targetKind,
              documentId: form.formId,
              documentTitle: form.name,
              anchor,
              found: value,
              snippet: `${label}: ${value}`.slice(0, 200),
            });
          }
        }
      }
    }

    // Stage 2 — verify the prose candidates (one batched call), capped.
    const capped = proseCandidates.slice(0, MAX_FACTUAL_CANDIDATES_PER_CHECK);
    if (capped.length > 0) {
      try {
        const items = capped.map((c, i) => ({
          i,
          label: c.fact.label,
          canonical: c.fact.canonical,
          passage: c.snippet,
        }));
        const body = await invokeModel(modelId, JSON.stringify(buildFactVerifyPrompt(items)));
        const json = JSON.parse(new TextDecoder('utf-8').decode(body)) as Record<string, unknown>;
        const blocks = (json?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
        const raw = blocks.find((c) => c?.type === 'text')?.text ?? null;
        const mismatches = raw ? parseMismatches(safeParseJsonFromModel(String(raw))) : new Map<number, string>();
        capped.forEach((c, i) => {
          if (!mismatches.has(i)) return;
          const found = mismatches.get(i) || c.found;
          findings.push({
            findingId: `profile-fact-${c.fact.factType}-${c.documentId}-${i}`,
            targetKind: c.targetKind,
            documentId: c.documentId,
            documentTitle: c.documentTitle,
            anchor: c.anchor,
            snippet: c.snippet,
            issueType: 'FACTUAL_INACCURACY',
            severity: 'major',
            title: `${c.fact.label} contradicts the company profile in "${c.documentTitle}"`,
            description:
              `The company profile shows ${c.fact.label} "${c.fact.canonical}"` +
              (found ? `, but this document shows "${found}".` : `, which this document appears to contradict.`),
            suggestion: `Update "${c.documentTitle}" so the ${c.fact.label} matches "${c.fact.canonical}".`,
          });
        });
      } catch (err) {
        console.warn('[compliance-review-consistency] C1 prose verify failed:', (err as Error)?.message);
      }
    }

    // FR-9 instrumentation.
    console.log(JSON.stringify({ tag: 'factual-candidates', factType: 'C1-identity', generated, kept: findings.length }));

    return findings;
  } catch (err) {
    console.warn('[compliance-review-consistency] profile-fact check failed:', (err as Error)?.message);
    return [];
  }
};
