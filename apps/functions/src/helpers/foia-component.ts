import type {
  FoiaComponentCreateRequest,
  FoiaComponentDBItem,
  FoiaComponentItem,
  FoiaComponentListItem,
  FoiaComponentLookup,
  FoiaMatchResult,
} from '@auto-rfp/core';
import {
  getFoiaComponentEmail,
  matchFoiaComponent,
  normalizeAgencyTitle,
} from '@auto-rfp/core';

import { FOIA_COMPONENT_PK } from '@/constants/foia';
import { getItem, putItem, queryAllBySkPrefix } from '@/helpers/db';
import { nowIso } from '@/helpers/date';

/**
 * DynamoDB access for the mirrored FOIA.gov agency-component directory.
 *
 * Layout under `PK = FOIA_COMPONENT`:
 *   `COMP#{componentId}`          the component record
 *   `BY_TITLE#{normalizedTitle}`  pointer row, with a count for ambiguity
 *   `BY_ABBR#{abbreviation}`      pointer row, with a count for ambiguity
 *
 * The pointer rows exist so a match is two `GetItem` calls rather than loading
 * all 614 components on every resolution. They carry `count` so the matcher can
 * refuse on ambiguity without reading each candidate — "Office of Inspector
 * General" alone has 12 identically-titled components.
 */

export const buildComponentSk = (componentId: string): string => `COMP#${componentId}`;

export const buildTitlePointerSk = (normalizedTitle: string): string =>
  `BY_TITLE#${normalizedTitle}`;

export const buildAbbrPointerSk = (abbreviation: string): string =>
  `BY_ABBR#${abbreviation.toUpperCase().replace(/[^A-Z0-9]/g, '')}`;

/** A pointer row: which component a key resolves to, and how many share it. */
interface PointerRow {
  componentId: string;
  count: number;
}

export const getFoiaComponent = async (
  componentId: string,
): Promise<FoiaComponentDBItem | null> =>
  getItem<FoiaComponentDBItem>(FOIA_COMPONENT_PK, buildComponentSk(componentId));

/** Resolves a normalized title to a component id, with its ambiguity count. */
export const findComponentIdByTitle = async (
  normalizedTitle: string,
): Promise<PointerRow | null> =>
  getItem<PointerRow>(FOIA_COMPONENT_PK, buildTitlePointerSk(normalizedTitle));

/** Resolves an abbreviation to a component id, with its ambiguity count. */
export const findComponentIdByAbbreviation = async (
  abbreviation: string,
): Promise<PointerRow | null> =>
  getItem<PointerRow>(FOIA_COMPONENT_PK, buildAbbrPointerSk(abbreviation));

/**
 * Writes a component and its two pointer rows.
 *
 * `counts` carries how many components share each key across the whole seeding
 * pass, computed by the caller BEFORE any write. That ordering matters: deriving
 * the count as a side effect of writing would let a failed write leave an
 * ambiguous key looking unique, turning a safe refusal into a wrong-agency match.
 *
 * Which component id an ambiguous pointer holds is irrelevant — the matcher
 * refuses on `count > 1` and never reads the id.
 */
export const upsertFoiaComponent = async (
  dto: FoiaComponentCreateRequest,
  /** Per-key totals for the whole pass. Absent means "assume unique". */
  counts?: { titles: Map<string, number>; abbrs: Map<string, number> },
): Promise<FoiaComponentItem> => {
  const normalizedTitle = normalizeAgencyTitle(dto.title);
  const now = nowIso();

  const existing = await getFoiaComponent(dto.componentId);

  const item = await putItem<FoiaComponentItem>(
    FOIA_COMPONENT_PK,
    buildComponentSk(dto.componentId),
    { ...dto, normalizedTitle, createdAt: existing?.createdAt ?? now },
    false,
  );

  if (normalizedTitle) {
    await putItem<PointerRow>(
      FOIA_COMPONENT_PK,
      buildTitlePointerSk(normalizedTitle),
      { componentId: dto.componentId, count: counts?.titles.get(normalizedTitle) ?? 1 },
      false,
    );
  }

  const abbr = (dto.abbreviation ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (abbr) {
    await putItem<PointerRow>(
      FOIA_COMPONENT_PK,
      buildAbbrPointerSk(abbr),
      { componentId: dto.componentId, count: counts?.abbrs.get(abbr) ?? 1 },
      false,
    );
  }

  return item;
};

/**
 * Every component, for the agency-picker UI.
 *
 * Paginated via `queryAllBySkPrefix`; the `COMP#` prefix excludes pointer rows.
 */
export const listFoiaComponents = async (): Promise<FoiaComponentListItem[]> => {
  const items = await queryAllBySkPrefix<FoiaComponentDBItem>(FOIA_COMPONENT_PK, 'COMP#');

  return items
    .map((c) => ({
      componentId: c.componentId,
      title: c.title,
      abbreviation: c.abbreviation,
      isActive: c.isActive,
      acceptsEmail: !!getFoiaComponentEmail(c),
      submissionWebUrl: c.submissionWebUrl,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
};

/**
 * Matches an agency name against the stored directory.
 *
 * Bridges the pure core matcher to DynamoDB. The lookup is memoized per call so
 * a hierarchy walk over several segments does not re-read the same pointer row,
 * and so the matcher stays synchronous and unit-testable.
 */
export const matchStoredFoiaComponent = async (
  organizationName: string | null | undefined,
  /** Candidate names to try in order — e.g. a HigherGov hierarchy, leaf-first. */
  extraCandidates: ReadonlyArray<string> = [],
): Promise<FoiaMatchResult> => {
  const titleCache = new Map<string, PointerRow | null>();
  const abbrCache = new Map<string, PointerRow | null>();

  // Prefetch every key the matcher could ask for, so the synchronous lookup
  // below can be satisfied from cache.
  const candidates = [organizationName, ...extraCandidates].filter(
    (c): c is string => typeof c === 'string' && c.trim().length > 0,
  );

  for (const candidate of candidates) {
    const abbrMatch = /\(([A-Za-z0-9][A-Za-z0-9\-.]{1,14})\)\s*$/.exec(candidate.trim());
    if (abbrMatch?.[1]) {
      const key = abbrMatch[1].toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!abbrCache.has(key)) abbrCache.set(key, await findComponentIdByAbbreviation(key));
    }

    const body = abbrMatch ? candidate.slice(0, abbrMatch.index) : candidate;
    const segments = body.split('.').map((s) => s.trim()).filter((s) => s.length > 0);
    for (const segment of segments.length > 0 ? segments : [body]) {
      const key = normalizeAgencyTitle(segment);
      if (key && !titleCache.has(key)) titleCache.set(key, await findComponentIdByTitle(key));
    }
  }

  const lookup: FoiaComponentLookup = {
    byNormalizedTitle: (k) => titleCache.get(k) ?? undefined,
    byAbbreviation: (k) => abbrCache.get(k) ?? undefined,
  };

  for (const candidate of candidates) {
    const result = matchFoiaComponent(candidate, lookup);
    // An ambiguous key is a definitive refusal — trying a broader candidate
    // would not make it less ambiguous.
    if (result.matched) return result;
    if (result.refusal === 'ABBREVIATION_AMBIGUOUS' || result.refusal === 'TITLE_AMBIGUOUS') {
      return result;
    }
  }

  return { matched: false, refusal: 'NO_MATCH' };
};
