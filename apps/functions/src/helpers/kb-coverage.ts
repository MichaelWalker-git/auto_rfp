/**
 * KB coverage probes — does this org's knowledge base hold the content a
 * document type requires?
 *
 * The categories operators care about ("personnel bios", "certification
 * records") are not entities in this system, so coverage is *probed* against
 * the two places that plausibly hold them:
 *
 *  - **Content library** — one paginated Query, bucketing the free-form
 *    `category` into coverage categories by case-insensitive alias.
 *  - **Company profile** — one GetItem, counting `fields` entries whose
 *    `category` is `CERTIFICATION` / `INSURANCE` and whose `value` is set.
 *
 * Both probes are org-scoped, so a single snapshot answers every document type
 * at once. That is what lets the document-selection dialog issue one request
 * and the KB-owner gap view reuse this exact computation.
 *
 * Nothing here decides whether to block — see `generation-preconditions.ts`.
 */
import {
  CONTENT_LIBRARY_PK,
  KB_COVERAGE_CATEGORIES,
  KB_COVERAGE_CATEGORY_KEYS,
  buildCoverageByDocumentType,
  type CompanyProfileFieldCategory,
  type KBCoverageCategory,
  type KBCoverageResponse,
  type KBCoverageSnapshot,
  type OrganizationItem,
} from '@auto-rfp/core';

import { queryAllBySkPrefix } from '@/helpers/db';
import { getCompanyProfile } from '@/helpers/company-profile';
import { getOrganizationById } from '@/helpers/org';

/** Env var name for the stage-wide coverage-gating kill switch. */
export const KB_COVERAGE_GATING_ENV = 'KB_COVERAGE_GATING';
export const KB_COVERAGE_GATING_OFF = 'off';

/**
 * Stage-wide kill switch. Checked before the org read so flipping it costs
 * nothing at all.
 */
export const isKBCoverageGatingDisabled = (): boolean =>
  process.env[KB_COVERAGE_GATING_ENV] === KB_COVERAGE_GATING_OFF;

/**
 * True when a coverage gap actually *blocks* generation for this org.
 * When false the gap is still computed and surfaced — it just warns.
 */
export const isKBCoverageGateArmed = (
  org: Pick<OrganizationItem, 'enableKBCoverageGate'> | null,
): boolean => !isKBCoverageGatingDisabled() && Boolean(org?.enableKBCoverageGate);

/**
 * Only the attributes the probe reads. A narrow projection keeps a realistic
 * org's whole content library inside a single 1 MB page.
 */
type ContentLibraryCoverageProjection = {
  category?: string;
  isArchived?: boolean;
  approvalStatus?: string;
};

/** Trimmed + lower-cased, so `  key personnel ` matches `Key Personnel`. */
const normalizeCategory = (value: string): string => value.trim().toLowerCase();

/**
 * Alias lookup: normalized content-library category → coverage categories it
 * satisfies. Built once per container from the core registry.
 */
const CONTENT_LIBRARY_ALIAS_INDEX: ReadonlyMap<string, readonly KBCoverageCategory[]> = (() => {
  const index = new Map<string, KBCoverageCategory[]>();
  for (const def of Object.values(KB_COVERAGE_CATEGORIES)) {
    for (const alias of def.contentLibraryAliases) {
      const normalized = normalizeCategory(alias);
      const existing = index.get(normalized);
      if (existing) existing.push(def.key);
      else index.set(normalized, [def.key]);
    }
  }
  return index;
})();

/** Coverage categories probed from the content library. */
const CONTENT_LIBRARY_CATEGORIES: readonly KBCoverageCategory[] = KB_COVERAGE_CATEGORY_KEYS.filter(
  (key) => KB_COVERAGE_CATEGORIES[key].sources.includes('CONTENT_LIBRARY_CATEGORY'),
);

/** Coverage categories probed from the company profile. */
const COMPANY_PROFILE_CATEGORIES: readonly KBCoverageCategory[] = KB_COVERAGE_CATEGORY_KEYS.filter(
  (key) => KB_COVERAGE_CATEGORIES[key].sources.includes('COMPANY_PROFILE_FIELD'),
);

/** Company-profile field category → the coverage categories it satisfies. */
const COMPANY_PROFILE_FIELD_INDEX: ReadonlyMap<
  CompanyProfileFieldCategory,
  readonly KBCoverageCategory[]
> = (() => {
  const index = new Map<CompanyProfileFieldCategory, KBCoverageCategory[]>();
  for (const def of Object.values(KB_COVERAGE_CATEGORIES)) {
    for (const fieldCategory of def.companyProfileCategories) {
      const existing = index.get(fieldCategory);
      if (existing) existing.push(def.key);
      else index.set(fieldCategory, [def.key]);
    }
  }
  return index;
})();

/** Which sources must actually be read to answer these coverage categories. */
export const resolveProbeSources = (
  required: readonly KBCoverageCategory[],
): { contentLibrary: boolean; companyProfile: boolean } => ({
  contentLibrary: required.some((key) =>
    KB_COVERAGE_CATEGORIES[key].sources.includes('CONTENT_LIBRARY_CATEGORY'),
  ),
  companyProfile: required.some((key) =>
    KB_COVERAGE_CATEGORIES[key].sources.includes('COMPANY_PROFILE_FIELD'),
  ),
});

/**
 * Count content-library items per coverage category.
 *
 * Uses the paginated `queryAllBySkPrefix` rather than a raw Query: the
 * `content-library/categories` handler issues its own `QueryCommand` and
 * ignores `LastEvaluatedKey`, so it silently truncates at 1 MB. A truncated
 * read here would report a category absent that the org actually has, and
 * block generation on it.
 */
/** Per-category hit counts from a single source. Absent key = zero hits. */
type CategoryCounts = Partial<Record<KBCoverageCategory, number>>;

const probeContentLibrary = async (orgId: string): Promise<CategoryCounts> => {
  const items = await queryAllBySkPrefix<ContentLibraryCoverageProjection>(
    CONTENT_LIBRARY_PK,
    `${orgId}#`,
    'category, isArchived, approvalStatus',
  );

  const counts: CategoryCounts = {};

  for (const item of items) {
    // Archived and deprecated content can't ground a generated document.
    if (item.isArchived) continue;
    if (item.approvalStatus === 'DEPRECATED') continue;
    if (!item.category) continue;

    const matched = CONTENT_LIBRARY_ALIAS_INDEX.get(normalizeCategory(item.category));
    if (!matched) continue;

    for (const key of matched) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return counts;
};

/**
 * Count company-profile fields per coverage category.
 *
 * A field with an empty `value` is a placeholder, not evidence — the profile
 * seeds rows for fields the org has not filled in yet.
 */
const probeCompanyProfile = async (orgId: string): Promise<CategoryCounts> => {
  const profile = await getCompanyProfile(orgId);
  const counts: CategoryCounts = {};
  if (!profile) return counts;

  for (const field of profile.fields ?? []) {
    if (!field?.value?.trim()) continue;

    const matched = COMPANY_PROFILE_FIELD_INDEX.get(field.category);
    if (!matched) continue;

    for (const key of matched) {
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return counts;
};

/**
 * Probe the org's KB and report what it holds.
 *
 * `required` narrows the work to the sources those categories need — a
 * `CERTIFICATIONS`-only document type still needs the content library (certs
 * may live there), but an `INSURANCE`-only one skips the Query entirely.
 * Passing nothing probes everything, which is what the KB-owner view wants.
 *
 * Only categories whose source was actually read appear in the snapshot; an
 * omitted category is treated as missing downstream, never as covered.
 */
export const computeKBCoverageSnapshot = async (
  orgId: string,
  required?: readonly KBCoverageCategory[],
): Promise<KBCoverageSnapshot> => {
  const { contentLibrary, companyProfile } = required
    ? resolveProbeSources(required)
    : { contentLibrary: true, companyProfile: true };

  const [contentLibraryCounts, companyProfileCounts] = await Promise.all<CategoryCounts>([
    contentLibrary ? probeContentLibrary(orgId) : {},
    companyProfile ? probeCompanyProfile(orgId) : {},
  ]);

  const snapshot: KBCoverageSnapshot = {};

  for (const key of KB_COVERAGE_CATEGORY_KEYS) {
    const needsContentLibrary = CONTENT_LIBRARY_CATEGORIES.includes(key);
    const needsCompanyProfile = COMPANY_PROFILE_CATEGORIES.includes(key);

    // Report a category only when *every* source it draws on was read. A
    // partial read can only ever produce a false gap: `CERTIFICATIONS` is
    // satisfied by the profile OR the library, so seeing zero in the library
    // alone says nothing. Omitting it is honest — downstream treats an absent
    // category as missing, and `resolveProbeSources` guarantees every required
    // category's sources are probed.
    if (needsContentLibrary && !contentLibrary) continue;
    if (needsCompanyProfile && !companyProfile) continue;

    const count =
      (needsContentLibrary ? contentLibraryCounts[key] ?? 0 : 0) +
      (needsCompanyProfile ? companyProfileCounts[key] ?? 0 : 0);

    snapshot[key] = { present: count > 0, count };
  }

  return snapshot;
};

/**
 * The full org-wide coverage report: what the KB holds, which document types
 * that covers, and whether a gap blocks or merely warns.
 *
 * Because the probes are org-scoped, this single computation serves both the
 * document-selection dialog and the KB owner's aggregate gap view — the
 * aggregate list *is* `byDocumentType`, not a second implementation.
 */
export const buildKBCoverageReport = async (orgId: string): Promise<KBCoverageResponse> => {
  const [snapshot, org] = await Promise.all([
    computeKBCoverageSnapshot(orgId),
    getOrganizationById(orgId),
  ]);

  return {
    snapshot,
    byDocumentType: buildCoverageByDocumentType(snapshot),
    isGateEnabled: isKBCoverageGateArmed(org),
  };
};
