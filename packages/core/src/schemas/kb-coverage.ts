/**
 * KB coverage precheck — vocabulary and per-document-type requirements.
 *
 * Document generation pulls its inputs from the knowledge base. When the KB
 * doesn't hold what a document type needs, generation fails late and badly.
 * This module declares *what* each document type requires; `apps/functions`
 * owns the DynamoDB probes that answer whether the org actually has it.
 *
 * Core stays AWS-free on purpose: the same registry drives the server-side
 * gate, the document-selection badges, and the KB-owner gap view.
 *
 * ## Why the categories are probed, not looked up
 *
 * The categories operators talk about — "personnel bios", "certification
 * records" — are not entities in this system. There is no personnel table and
 * no certification record, and `ContentLibraryItem.category` is free-form
 * text, not an enum. So coverage can only be *probed* against the two places
 * that plausibly hold this content, via case-insensitive category aliases and
 * the company-profile field categories. That makes false positives possible
 * (one placeholder item marks a category present); it is still strictly better
 * than discovering the gap after three generation retries.
 *
 * ## READ THIS BEFORE ARMING `enableKBCoverageGate` FOR AN ORG
 *
 * What this check probes overlaps only *partially* with what generation reads,
 * so a verdict here is evidence, not proof. Verified against the generation
 * path in `apps/functions/src/helpers/document-context.ts`:
 *
 * - `TEAM_QUALIFICATIONS` draws most of its context from the **indexed-KB
 *   document** corpus, not the content library — `DOC_TYPE_BUDGETS` gives it
 *   `kb: 12_000` vs `contentLib: 4_000`, and the comment above it reads
 *   "maximise KB (personnel/certs), reduce content library". That corpus is
 *   searched semantically via Pinecone and is **not probed here**. So bios that
 *   live in an uploaded KB document are invisible to `PERSONNEL_BIOS`.
 * - `loadContentLibraryContext` retrieves by **semantic similarity to the
 *   solicitation** (`semanticSearchContentLibrary`, above a minimum score),
 *   never by category. An item filed under `Key Personnel` therefore makes this
 *   probe report "present" without being retrievable for a given solicitation.
 * - The generation path **never reads the company profile at all** (no
 *   `getCompanyProfile` caller under `handlers/rfp-document/` or the
 *   `document-*` helpers). A `CERTIFICATIONS` pass can be satisfied entirely by
 *   data generation cannot see.
 *
 * The consequence is symmetric and worth stating plainly: with the flag armed,
 * this gate can **block a generation that would have succeeded** (content lives
 * in indexed KB docs) and can **pass one that will still be ungrounded** (a
 * placeholder row, or a profile field generation never reads). That is an
 * acceptable trade while the flag is off everywhere and the check only warns —
 * it is the thing that matters on the day someone turns blocking on. Adding an
 * indexed-KB-document probe is the fix; it was deliberately out of scope here.
 */
import { z } from 'zod';

import { CompanyProfileFieldCategorySchema } from './company-profile';
import { RFP_DOCUMENT_TYPES } from './rfp-document';

// ─── Coverage categories ────────────────────────────────────────────────────────

/**
 * The closed set of KB coverage categories. A category belongs here only if a
 * real probe can answer it — adding a name without a probe would produce a
 * requirement that can never be satisfied.
 */
export const KBCoverageCategorySchema = z.enum([
  'PERSONNEL_BIOS',
  'CERTIFICATIONS',
  'INSURANCE',
]);

export type KBCoverageCategory = z.infer<typeof KBCoverageCategorySchema>;

/** Where a coverage category is probed from. */
export const KBCoverageSourceSchema = z.enum([
  'CONTENT_LIBRARY_CATEGORY',
  'COMPANY_PROFILE_FIELD',
]);

export type KBCoverageSource = z.infer<typeof KBCoverageSourceSchema>;

/**
 * Declarative probe descriptor. Deliberately carries no AWS types so the web
 * bundle can import the same rows the Lambda gate evaluates.
 *
 * A category may draw on both sources — `CERTIFICATIONS` is satisfied by
 * either a company-profile `CERTIFICATION` field or a content-library item
 * filed under a certification-ish category, because orgs legitimately keep
 * certs in both places.
 */
export const KBCoverageCategoryDefSchema = z.object({
  key: KBCoverageCategorySchema,
  /** Operator-facing name, used verbatim in the 409 body and the UI badge. */
  label: z.string().min(1),
  /** Every source this category can be satisfied by. Any one of them suffices. */
  sources: z.array(KBCoverageSourceSchema).min(1),
  /** Case-insensitive aliases matched against the free-form content-library category. */
  contentLibraryAliases: z.array(z.string()).default([]),
  /** Company-profile field categories that satisfy this coverage category. */
  companyProfileCategories: z.array(CompanyProfileFieldCategorySchema).default([]),
});

export type KBCoverageCategoryDef = z.infer<typeof KBCoverageCategoryDefSchema>;

/**
 * The probe registry. Aliases reflect the seeded content-library vocabulary
 * (`Key Personnel`, `Qualifications`, …) plus the variants orgs commonly use.
 *
 * `INSURANCE` is company-profile-only: no seeded content-library category
 * covers insurance, so inventing an alias for it would only create false
 * positives.
 */
export const KB_COVERAGE_CATEGORIES: Record<KBCoverageCategory, KBCoverageCategoryDef> = {
  PERSONNEL_BIOS: {
    key: 'PERSONNEL_BIOS',
    label: 'personnel bios',
    sources: ['CONTENT_LIBRARY_CATEGORY'],
    contentLibraryAliases: [
      'Key Personnel',
      'Personnel',
      'Key Staff',
      'Staff',
      'Team',
      'Resumes',
      'Bios',
    ],
    companyProfileCategories: [],
  },
  CERTIFICATIONS: {
    key: 'CERTIFICATIONS',
    label: 'certification records',
    sources: ['COMPANY_PROFILE_FIELD', 'CONTENT_LIBRARY_CATEGORY'],
    contentLibraryAliases: ['Certifications', 'Certification', 'Qualifications'],
    companyProfileCategories: ['CERTIFICATION'],
  },
  INSURANCE: {
    key: 'INSURANCE',
    label: 'insurance documents',
    sources: ['COMPANY_PROFILE_FIELD'],
    contentLibraryAliases: [],
    companyProfileCategories: ['INSURANCE'],
  },
};

/** All coverage categories, in registry order. */
export const KB_COVERAGE_CATEGORY_KEYS = Object.keys(
  KB_COVERAGE_CATEGORIES,
) as KBCoverageCategory[];

/** Operator-facing label for a coverage category. */
export const getKBCoverageCategoryLabel = (key: KBCoverageCategory): string =>
  KB_COVERAGE_CATEGORIES[key].label;

// ─── Per-document-type requirements (the config the gate reads) ──────────────────

/**
 * Which KB coverage categories each document type requires.
 *
 * This is the config, not code: a new document type adds a row here rather
 * than a branch in the gate. A type absent from this map has no KB
 * requirements and is always considered covered.
 *
 * Keys are constrained to real document types so a typo is a compile error;
 * `Partial` because most types have no requirements.
 */
export const DOCUMENT_TYPE_REQUIRED_COVERAGE: Partial<
  Record<keyof typeof RFP_DOCUMENT_TYPES, readonly KBCoverageCategory[]>
> = {
  TEAM_QUALIFICATIONS: ['PERSONNEL_BIOS', 'CERTIFICATIONS'],
  CERTIFICATIONS: ['CERTIFICATIONS'],
};

/**
 * Required coverage categories for a document type.
 *
 * Fails **open** for anything unmapped — load-bearing, because
 * `RFPDocumentTypeSchema` accepts arbitrary `UPPER_SNAKE_CASE` org-defined
 * slugs, and an org's custom type must never hit a coverage block.
 */
export const getRequiredCoverageCategories = (
  documentType: string,
): readonly KBCoverageCategory[] =>
  DOCUMENT_TYPE_REQUIRED_COVERAGE[documentType as keyof typeof RFP_DOCUMENT_TYPES] ?? [];

/** Document types that carry at least one KB coverage requirement. */
export const KB_COVERAGE_GATED_DOCUMENT_TYPES = Object.keys(
  DOCUMENT_TYPE_REQUIRED_COVERAGE,
) as (keyof typeof RFP_DOCUMENT_TYPES)[];

// ─── Coverage results (shared by the gate, the endpoint, and the UI) ─────────────

/** Per-category probe outcome. `count` is informational — the gate reads `present`. */
export const KBCoverageCategoryStatusSchema = z.object({
  present: z.boolean(),
  count: z.number().int().nonnegative(),
});

export type KBCoverageCategoryStatus = z.infer<typeof KBCoverageCategoryStatusSchema>;

/**
 * The org-wide probe result. Both probes are org-scoped, so a single snapshot
 * answers every document type at once — which is why the dialog needs one
 * request and the KB-owner view is the same computation rather than a second
 * implementation.
 */
export const KBCoverageSnapshotSchema = z.record(
  KBCoverageCategorySchema,
  KBCoverageCategoryStatusSchema,
);

export type KBCoverageSnapshot = z.infer<typeof KBCoverageSnapshotSchema>;

/**
 * A named missing category. The 409 body and the UI badge both render `label`,
 * so the operator sees the same words in both places; `key` is what code
 * branches on.
 */
export const KBCoverageMissingCategorySchema = z.object({
  key: KBCoverageCategorySchema,
  label: z.string(),
});

export type KBCoverageMissingCategory = z.infer<typeof KBCoverageMissingCategorySchema>;

/** Coverage verdict for one document type. */
export const KBCoverageDocumentTypeStatusSchema = z.object({
  covered: z.boolean(),
  missing: z.array(KBCoverageMissingCategorySchema),
});

export type KBCoverageDocumentTypeStatus = z.infer<typeof KBCoverageDocumentTypeStatusSchema>;

/** `GET /rfp-document/kb-coverage` response — serves the dialog and the gap view. */
export const KBCoverageResponseSchema = z.object({
  snapshot: KBCoverageSnapshotSchema,
  /** Keyed by document type; only types with requirements appear. */
  byDocumentType: z.record(z.string(), KBCoverageDocumentTypeStatusSchema),
  /** Org flag state, so the UI knows whether a gap warns or blocks. */
  isGateEnabled: z.boolean(),
});

export type KBCoverageResponse = z.infer<typeof KBCoverageResponseSchema>;

// ─── Derivation ─────────────────────────────────────────────────────────────────

/**
 * Missing categories for a document type given a snapshot.
 *
 * A category absent from the snapshot counts as missing: the snapshot only
 * omits a category when its probe was skipped, and treating "unknown" as
 * covered would let the gate pass on data it never read.
 */
export const getMissingCoverageCategories = (
  documentType: string,
  snapshot: KBCoverageSnapshot,
): KBCoverageMissingCategory[] =>
  getRequiredCoverageCategories(documentType)
    .filter((key) => !snapshot[key]?.present)
    .map((key) => ({ key, label: getKBCoverageCategoryLabel(key) }));

/** Per-document-type verdicts for every type that has requirements. */
export const buildCoverageByDocumentType = (
  snapshot: KBCoverageSnapshot,
): Record<string, KBCoverageDocumentTypeStatus> =>
  Object.fromEntries(
    KB_COVERAGE_GATED_DOCUMENT_TYPES.map((documentType) => {
      const missing = getMissingCoverageCategories(documentType, snapshot);
      return [documentType, { covered: missing.length === 0, missing }];
    }),
  );

/** Renders a missing list as prose for a toast or badge: "personnel bios, certification records". */
export const formatMissingCoverageCategories = (
  missing: readonly KBCoverageMissingCategory[],
): string => missing.map(({ label }) => label).join(', ');

// ─── Error codes ────────────────────────────────────────────────────────────────

/**
 * Machine-readable `code` values for the 409s the pre-generation gate returns.
 * One gate, two precondition types, one refusal model — `SOLUTION_PLAN_REQUIRED`
 * is re-declared here (it also lives in `SolutionPlanErrorCodeSchema`, which
 * covers plan-specific errors beyond generation) so a client can exhaustively
 * switch on what `generate-document` may refuse with.
 */
export const GenerationPreconditionErrorCodeSchema = z.enum([
  'SOLUTION_PLAN_REQUIRED',
  'KB_COVERAGE_INCOMPLETE',
]);

export type GenerationPreconditionErrorCode = z.infer<
  typeof GenerationPreconditionErrorCodeSchema
>;

/** 409 body when the KB doesn't hold what the document type requires. */
export const KBCoverageIncompleteBodySchema = z.object({
  code: z.literal('KB_COVERAGE_INCOMPLETE'),
  message: z.string(),
  missingCategories: z.array(KBCoverageMissingCategorySchema),
});

export type KBCoverageIncompleteBody = z.infer<typeof KBCoverageIncompleteBodySchema>;

/** Builds the refusal message, naming the gaps so the operator knows what to fix. */
export const buildKBCoverageIncompleteMessage = (
  missing: readonly KBCoverageMissingCategory[],
): string =>
  `The knowledge base is missing content this document type requires: ${formatMissingCoverageCategories(
    missing,
  )}. Add it to the knowledge base, then generate.`;
