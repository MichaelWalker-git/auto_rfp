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
import { loadRFPDocumentHtml } from '@/helpers/rfp-document';
import { stripHtml } from '@/helpers/compliance-review-html';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

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

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word presence test. A plain substring `.includes` produced false-positive
 * findings because the identifier acronyms occur INSIDE ordinary words — "being"
 * / "protein" / "ceiling" contain "ein", "cage" is itself a word — so any doc with
 * those words got a spurious inconsistency finding. `\b...\b` requires the token
 * to stand alone.
 *
 * `caseSensitive` matters for the two uses:
 *  - LABEL match → case-sensitive: the federal identifiers (UEI/CAGE/EIN) are
 *    ALWAYS uppercase acronyms in proposal text, so "CAGE" is the label but the
 *    lowercase word "cage" is not — case-sensitivity is what separates them
 *    (word boundaries alone can't).
 *  - VALUE match → case-insensitive: for the "value is absent" check, matching
 *    loosely means we're LESS likely to wrongly report it missing.
 */
export const containsWord = (haystack: string, needle: string, caseSensitive = false): boolean => {
  const n = needle.trim();
  if (!n) return false;
  return new RegExp(`\\b${escapeRegex(n)}\\b`, caseSensitive ? '' : 'i').test(haystack);
};

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
            texts.set(d.documentId, norm(stripHtml(await loadRFPDocumentHtml(d.htmlContentKey))));
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
