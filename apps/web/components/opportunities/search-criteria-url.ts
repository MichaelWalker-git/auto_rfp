/**
 * URL ↔ search-criteria serialization, shared by the org-level and project-level
 * Search Opportunities pages.
 *
 * These three functions previously existed as near-identical copies in both
 * pages, so every field added to search had to be added in two places — which is
 * how `higherGovSearchId` came to be handled in neither.
 */

import type { SavedSearch } from '@auto-rfp/core';

import type { SearchOpportunityCriteria } from '@/lib/hooks/use-search-opportunities';
import type { FormValues } from './SearchOpportunityForm';

/** Default page size; kept out of the URL so links stay readable. */
const DEFAULT_LIMIT = 25;

/**
 * A `limit` off the URL is untrusted: a hand-crafted `?limit=abc` yields `NaN`,
 * and a negative/zero value is meaningless to the API. Fall back to the default
 * unless it parses to a positive integer.
 */
const parseLimit = (raw: string | null): number => {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_LIMIT;
};

/** `MM/dd/yyyy` (how saved searches store dates) → `yyyy-MM-dd` (what the URL uses). */
const mmDdYyyyToIso = (d?: string): string | undefined => {
  if (!d) return undefined;
  const [mm, dd, yyyy] = d.split('/');
  if (!mm || !dd || !yyyy) return undefined;
  // Pad, since a stored `7/6/2026` would otherwise produce a non-ISO `2026-7-6`.
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
};

/**
 * `yyyy-MM-dd` → a Date at local midnight.
 *
 * `new Date('2026-07-06')` is parsed as UTC midnight, which renders as the 5th for
 * anyone west of UTC — so a date picker restored from the URL showed the day
 * before. Building from the parts keeps the calendar day the user chose.
 */
const isoToLocalDate = (iso: string): Date | undefined => {
  const [yyyy, mm, dd] = iso.split('-').map(Number);
  if (!yyyy || !mm || !dd) return undefined;
  return new Date(yyyy, mm - 1, dd);
};

export const criteriaToParams = (c: SearchOpportunityCriteria): URLSearchParams => {
  const p = new URLSearchParams();
  if (c.keywords)            p.set('q', c.keywords);
  if (c.sources?.length)     p.set('source', c.sources[0]);
  if (c.naics?.length)       p.set('naics', c.naics.join(','));
  if (c.setAsideCode)        p.set('setAside', c.setAsideCode);
  if (c.postedFrom)          p.set('from', c.postedFrom);
  if (c.postedTo)            p.set('to', c.postedTo);
  if (c.closingFrom)         p.set('closingFrom', c.closingFrom);
  if (c.closingTo)           p.set('closingTo', c.closingTo);
  if (c.higherGovSourceType) p.set('hgSource', c.higherGovSourceType);
  if (c.higherGovSearchId)   p.set('hgId', c.higherGovSearchId);
  // Only serialize non-defaults, so a plain HigherGov search stays a readable URL.
  if (c.higherGovMarket && c.higherGovMarket !== 'all') p.set('hgMarket', c.higherGovMarket);
  if (c.higherGovActiveOnly === false) p.set('hgActive', '0');
  if (c.limit && c.limit !== DEFAULT_LIMIT) p.set('limit', String(c.limit));
  return p;
};

/**
 * Query string that reopens a saved search on the search page.
 *
 * Saved searches used to navigate to `?search=<json>`, which no page on this route
 * reads — only a since-deleted SAM.gov-only search page did — so the run button
 * landed on an empty form. Going through `criteriaToParams` produces the flat
 * shape the search page actually parses.
 */
export const savedSearchToParams = (s: SavedSearch): URLSearchParams =>
  criteriaToParams({
    keywords:            s.criteria.keywords,
    // A stored DIBBS search reopens against SAM.gov — DIBBS is no longer selectable.
    sources:             [s.source === 'HIGHER_GOV' ? 'HIGHER_GOV' : 'SAM_GOV'],
    naics:               s.criteria.naics,
    setAsideCode:        s.criteria.setAsideCode,
    postedFrom:          mmDdYyyyToIso(s.criteria.postedFrom),
    postedTo:            mmDdYyyyToIso(s.criteria.postedTo),
    closingFrom:         mmDdYyyyToIso(s.criteria.closingFrom),
    closingTo:           mmDdYyyyToIso(s.criteria.closingTo),
    higherGovSourceType: s.criteria.higherGovSourceType,
    higherGovSearchId:   s.criteria.higherGovSearchId,
    // Omitted before: a search saved with a non-default market or activeOnly=false
    // silently reopened as 'all'/active-only from this page (though not from the
    // in-page "Saved Searches" tab, which already carried them) — a different search
    // than the one the user saved.
    higherGovMarket:     s.criteria.higherGovMarket,
    higherGovActiveOnly: s.criteria.higherGovActiveOnly,
    limit:               s.criteria.limit,
  });

/**
 * Whether the URL describes a search at all, as opposed to a bare page visit.
 *
 * `hgId` counts: a HigherGov search ID encodes its own keywords, filters and date
 * range, so an ID on its own is a complete search. Omitting it here made such a
 * search parse as empty, which is why a saved HigherGov search restored nothing.
 */
const hasAnyCriteria = (p: URLSearchParams): boolean =>
  p.has('q') || p.has('source') || p.has('naics') || p.has('setAside') || p.has('from') || p.has('hgId');

/**
 * The UI now offers SAM.gov and HigherGov only, but URLs predating that are still
 * bookmarked and still linked from saved searches — `?source=DIBBS` and `?source=all`
 * were both valid. Anything unrecognised degrades to SAM.gov rather than stranding
 * the form on a provider it can no longer select.
 */
const parseSource = (raw: string | null): 'SAM_GOV' | 'HIGHER_GOV' =>
  raw === 'HIGHER_GOV' ? 'HIGHER_GOV' : 'SAM_GOV';

export const paramsToFormValues = (p: URLSearchParams): Partial<FormValues> | null => {
  if (!hasAnyCriteria(p)) return null;
  const parseDate = (s: string | null) => (s ? isoToLocalDate(s) : undefined);
  return {
    keywords: p.get('q') ?? '',
    source: parseSource(p.get('source')),
    naics: p.get('naics')?.split(',').filter(Boolean) ?? [],
    setAsideCode: p.get('setAside') ?? '',
    postedFrom: parseDate(p.get('from')),
    postedTo: parseDate(p.get('to')),
    closingFrom: parseDate(p.get('closingFrom')),
    closingTo: parseDate(p.get('closingTo')),
    higherGovSourceType: (p.get('hgSource') ?? '') as FormValues['higherGovSourceType'],
    higherGovSearchId: p.get('hgId') ?? '',
    higherGovMarket: (p.get('hgMarket') ?? 'all') as FormValues['higherGovMarket'],
    higherGovActiveOnly: p.get('hgActive') !== '0',
  };
};

export const paramsToCriteria = (p: URLSearchParams): SearchOpportunityCriteria | null => {
  if (!hasAnyCriteria(p)) return null;
  const source = parseSource(p.get('source'));
  return {
    keywords:            p.get('q') ?? undefined,
    sources:             [source],
    naics:               p.get('naics')?.split(',').filter(Boolean) ?? undefined,
    setAsideCode:        p.get('setAside') ?? undefined,
    postedFrom:          p.get('from') ?? undefined,
    postedTo:            p.get('to') ?? undefined,
    closingFrom:         p.get('closingFrom') ?? undefined,
    closingTo:           p.get('closingTo') ?? undefined,
    higherGovSourceType: p.get('hgSource') ?? undefined,
    higherGovSearchId:   p.get('hgId') ?? undefined,
    // Defaults to 'all', NOT undefined. `criteriaToParams` omits this param when it is
    // 'all' to keep URLs readable, so an absent param means "all markets" — and sending
    // undefined instead let HigherGov apply its own `federal_contract` default. That
    // showed the UI reading "All sources" while returning the federal-only count (18
    // instead of 310).
    higherGovMarket:     (p.get('hgMarket') ?? 'all') as SearchOpportunityCriteria['higherGovMarket'],
    // Explicit `true` rather than undefined: the results bar keys its "open
    // opportunities only" note off this, so an omitted param must still read as on —
    // which is also what the backend defaults to.
    higherGovActiveOnly: p.get('hgActive') !== '0',
    limit:               parseLimit(p.get('limit')),
  };
};
