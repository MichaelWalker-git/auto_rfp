/**
 * Deterministic missing-required-forms cross-check (full review only).
 *
 * The LLM review can *notice* a missing form, but relying on it alone is
 * unreliable — it may not enumerate every required attachment, and it can't be
 * audited. This module adds a ground-truth diff:
 *
 *   expected forms (what the solicitation requires)  −  present forms (what the
 *   package actually contains, from `listRequiredFormsByOpportunity`, already in
 *   the PackageInventory)  =  MISSING_FORM findings.
 *
 * The "expected" side is built HYBRID: prefer the Executive Brief's already-
 * extracted `attachmentsAndForms` list (zero extra model cost) and fall back to
 * a single focused Bedrock extraction over the solicitation text when no brief
 * exists. The diff itself is deterministic string matching, so the resulting
 * findings are trustworthy and reproducible — unlike the LLM's own guesses.
 *
 * Every step is best-effort: if the brief is missing, the extraction fails, or
 * anything throws, we return `[]` so the cross-check never fails the review.
 */
import { invokeModel } from '@/helpers/bedrock-http-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import {
  loadAllSolicitationTexts,
  getExecutiveBriefByProjectId,
} from '@/helpers/executive-opportunity-brief';
import {
  MAX_SOLICITATION_CHARS_FOR_FORMS,
  MAX_TOKENS_EXPECTED_FORMS,
  MISSING_FORM_MIN_MATCH_LEN,
} from '@/constants/compliance-review';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { RawFinding } from '@/helpers/compliance-review-validate';

// ─── Name normalization ─────────────────────────────────────────────────────

/**
 * Conservative normalization for matching a solicitation-named form against a
 * detected form. Mirrors `detect-required-forms.ts` so the two sides key the
 * same way: lowercase, collapse whitespace, strip continuation markers and
 * punctuation. Deliberately NOT fuzzy — we never merge "Attachment 3" with
 * "Attachment 5" (that would hide a genuinely missing form).
 */
export const normalizeFormNameKey = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[([{]\s*(cont(inued|\.)?|continued)\s*[)\]}]/g, '')
    .replace(/[-–—,]?\s*(cont(inued|\.)?|continued)\s*$/g, '')
    .replace(/[([{]\s*\d+\s*[)\]}]\s*$/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

// ─── Expected-forms sources ─────────────────────────────────────────────────

/** Parse the model's `{ forms: [...] }` output into clean form-name strings. */
export const parseExpectedFormsResponse = (modelOut: unknown): string[] => {
  if (!modelOut || typeof modelOut !== 'object') return [];
  const forms = (modelOut as Record<string, unknown>).forms;
  if (!Array.isArray(forms)) return [];
  return forms
    .map((f) => {
      if (typeof f === 'string') return f;
      if (f && typeof f === 'object' && typeof (f as Record<string, unknown>).name === 'string') {
        return (f as Record<string, unknown>).name as string;
      }
      return '';
    })
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
};

const buildExtractionPrompt = (solicitationText: string) => {
  const userText =
    'Read the following government solicitation text and list ONLY the forms, ' +
    'attachments, exhibits, or certifications that the OFFEROR/VENDOR must complete, ' +
    'sign, and submit as part of their proposal.\n\n' +
    'INCLUDE things like: standard forms (e.g. SF-33, SF-1449), representations & ' +
    'certifications, price/cost schedules the vendor fills in, compliance/response ' +
    'matrices, and named attachments/exhibits that must be returned completed.\n\n' +
    'DO NOT include: response volumes or narrative documents the vendor writes from ' +
    'scratch (Technical Volume, Cover Letter, Past Performance narrative), informational ' +
    'documents with nothing to fill in, or the solicitation sections themselves.\n\n' +
    'Return the EXACT name/label each item is referred to by in the solicitation.\n\n' +
    'Return JSON only: { "forms": ["<exact name>", ...] }. ' +
    'If none are clearly required, return { "forms": [] }.\n\n' +
    'SOLICITATION TEXT:\n' +
    solicitationText;

  return {
    anthropic_version: 'bedrock-2023-05-31',
    system:
      'You extract the list of vendor-completable forms/attachments a government ' +
      'solicitation requires the offeror to submit. Return ONLY valid JSON (no markdown, no commentary).',
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    max_tokens: MAX_TOKENS_EXPECTED_FORMS,
  };
};

/**
 * Read the Executive Brief's already-extracted required forms/attachments list.
 * Returns `[]` when no brief exists or the section is empty — never throws.
 */
export const getExpectedFormsFromBrief = async (
  projectId: string,
  oppId: string,
): Promise<string[]> => {
  try {
    const brief = await getExecutiveBriefByProjectId(projectId, oppId);
    // submissionCompliance.attachmentsAndForms is the free-text list of forms/
    // attachments the solicitation calls out. requiredDocuments is deliberately
    // NOT used here — those describe response VOLUMES (Technical Volume, etc.),
    // not fillable forms, and would generate noise in a forms diff.
    const list =
      brief?.sections?.requirements?.data?.submissionCompliance?.attachmentsAndForms;
    if (!Array.isArray(list)) return [];
    return list.map((s) => String(s).trim()).filter((s) => s.length > 0);
  } catch {
    // Brief not initialized for this opportunity, or read failed — that's fine,
    // the caller falls back to fresh extraction.
    return [];
  }
};

/**
 * Freshly extract the required-forms list from the solicitation text via a
 * single focused Bedrock call. Returns `[]` on empty text or any failure.
 */
export const extractExpectedFormsFromSolicitation = async (args: {
  projectId: string;
  oppId: string;
  modelId: string;
}): Promise<string[]> => {
  const { projectId, oppId, modelId } = args;
  try {
    const solicitationText = await loadAllSolicitationTexts(
      projectId,
      oppId,
      MAX_SOLICITATION_CHARS_FOR_FORMS,
    );
    if (!solicitationText.trim()) return [];

    const responseBody = await invokeModel(modelId, JSON.stringify(buildExtractionPrompt(solicitationText)));
    const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
    const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
    const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? null;
    const modelOut = rawText ? safeParseJsonFromModel(String(rawText)) : null;
    return parseExpectedFormsResponse(modelOut);
  } catch (err) {
    console.warn(
      '[compliance-review-missing-forms] solicitation extraction failed:',
      (err as Error)?.message,
    );
    return [];
  }
};

/**
 * Build the "expected forms" ground truth (HYBRID): use the brief's list when a
 * brief exists and names any forms; otherwise fall back to a fresh extraction.
 */
export const buildExpectedForms = async (args: {
  projectId: string;
  oppId: string;
  modelId: string;
}): Promise<string[]> => {
  const fromBrief = await getExpectedFormsFromBrief(args.projectId, args.oppId);
  if (fromBrief.length > 0) return fromBrief;
  return extractExpectedFormsFromSolicitation(args);
};

// ─── Deterministic diff ──────────────────────────────────────────────────────

/**
 * True when `needle` occurs in `haystack` delimited by whitespace or a string
 * edge — i.e. as a whole run of tokens, never splitting a word or (critically) a
 * number. Both inputs are already normalized to `[a-z0-9 ]`.
 *
 * Plain substring containment silently defeated the cross-check: "attachment 1"
 * is a substring of "attachment 10" (and "sf3" of "sf30"), so a genuinely
 * missing lower-numbered form was treated as present whenever a higher-numbered
 * sibling existed — the exact "never merge Attachment 3 with Attachment 5"
 * failure normalizeFormNameKey warns about. Requiring a word boundary after the
 * match blocks "attachment 1" ⊂ "attachment 10" (next char is a digit) while
 * still allowing "sf33" ⊂ "sf33 solicitation offer and award" (next char space).
 */
const containsAtWordBoundary = (haystack: string, needle: string): boolean => {
  if (!needle || needle.length > haystack.length) return false;
  for (let from = 0; ; ) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) return false;
    const beforeOk = idx === 0 || haystack[idx - 1] === ' ';
    const after = idx + needle.length;
    const afterOk = after === haystack.length || haystack[after] === ' ';
    if (beforeOk && afterOk) return true;
    from = idx + 1;
  }
};

/**
 * True when an expected form name is already accounted for by a present form.
 * Match = normalized equality, OR either name contains the other at a word
 * boundary (guarded by a min length so short tokens can't match everything).
 * Containment handles the common "SF-33" vs "SF-33 Solicitation, Offer and Award"
 * naming mismatch without letting "Attachment 1" collide with "Attachment 10".
 */
const isFormPresent = (expectedKey: string, presentKeys: string[]): boolean =>
  presentKeys.some((presentKey) => {
    if (!presentKey) return false;
    if (presentKey === expectedKey) return true;
    if (expectedKey.length >= MISSING_FORM_MIN_MATCH_LEN && containsAtWordBoundary(presentKey, expectedKey)) return true;
    if (presentKey.length >= MISSING_FORM_MIN_MATCH_LEN && containsAtWordBoundary(expectedKey, presentKey)) return true;
    return false;
  });

/**
 * Diff expected forms against the package inventory + the LLM's own findings and
 * emit a deterministic MISSING_FORM finding for each expected form that is
 * neither present in the package nor already flagged by the model review.
 *
 * Pure function (no I/O) — the inputs are the already-gathered expected list,
 * the inventory, and the model's raw findings.
 */
export const crossCheckMissingForms = (
  expectedNames: string[],
  inventory: PackageInventory,
  existingFindings: readonly RawFinding[],
): RawFinding[] => {
  const presentKeys = inventory.forms.map((f) => normalizeFormNameKey(f.name)).filter(Boolean);

  // Text the model already used to name a missing form — so we don't double-
  // report a form the LLM review also flagged (their titles/fingerprints differ,
  // so validateAndTagFindings wouldn't otherwise dedup them).
  const llmMissingText = existingFindings
    .filter((f) => f.issueType === 'MISSING_FORM')
    .map((f) => normalizeFormNameKey(`${f.title ?? ''} ${f.documentTitle ?? ''}`))
    .filter(Boolean);

  const findings: RawFinding[] = [];
  const seenExpected = new Set<string>();

  for (const rawName of expectedNames) {
    const key = normalizeFormNameKey(rawName);
    if (!key) continue;
    if (seenExpected.has(key)) continue; // dedup the expected list itself
    seenExpected.add(key);

    if (isFormPresent(key, presentKeys)) continue;
    // Word-boundary match here too, for the same reason as isFormPresent: a plain
    // includes() would let an LLM finding for "Attachment 10" suppress a real
    // "Attachment 1" cross-check finding.
    if (
      key.length >= MISSING_FORM_MIN_MATCH_LEN &&
      llmMissingText.some((t) => containsAtWordBoundary(t, key))
    )
      continue;

    findings.push({
      findingId: `missing-form-${key.replace(/\s+/g, '-')}`,
      targetKind: 'FORM_MISSING',
      issueType: 'MISSING_FORM',
      severity: 'major',
      title: `Missing required form: "${rawName.trim()}"`,
      description:
        `The solicitation appears to require the form/attachment "${rawName.trim()}", but no ` +
        `matching form was found in the submission package. Confirm whether it must be completed ` +
        `and submitted.`,
      suggestion: `Add and complete "${rawName.trim()}", then attach it to the proposal package.`,
    });
  }

  return findings;
};

// ─── Resilient entry point (used by the full-review engine) ─────────────────

/**
 * Build expected forms (hybrid) and diff them against the package. Wrapped so
 * any failure degrades to an empty list — the missing-forms cross-check must
 * never fail the whole review.
 */
export const computeMissingFormFindings = async (args: {
  projectId: string;
  oppId: string;
  modelId: string;
  inventory: PackageInventory;
  existingFindings: readonly RawFinding[];
}): Promise<RawFinding[]> => {
  try {
    const expected = await buildExpectedForms({
      projectId: args.projectId,
      oppId: args.oppId,
      modelId: args.modelId,
    });
    if (expected.length === 0) return [];
    return crossCheckMissingForms(expected, args.inventory, args.existingFindings);
  } catch (err) {
    console.warn(
      '[compliance-review-missing-forms] cross-check failed:',
      (err as Error)?.message,
    );
    return [];
  }
};
