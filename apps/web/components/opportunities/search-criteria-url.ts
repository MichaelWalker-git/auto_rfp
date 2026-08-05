/**
 * URL ↔ search-criteria serialization, shared by the org-level and project-level
 * Search Opportunities pages.
 *
 * These three functions previously existed as near-identical copies in both
 * pages, so every field added to search had to be added in two places — which is
 * how `higherGovSearchId` came to be handled in neither.
 */

import type { SearchOpportunityCriteria } from '@/lib/hooks/use-search-opportunities';
import type { FormValues } from './SearchOpportunityForm';

/** Default page size; kept out of the URL so links stay readable. */
const DEFAULT_LIMIT = 25;

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
  if (c.limit && c.limit !== DEFAULT_LIMIT) p.set('limit', String(c.limit));
  return p;
};

/**
 * Whether the URL describes a search at all, as opposed to a bare page visit.
 *
 * `hgId` counts: a HigherGov search ID encodes its own keywords, filters and date
 * range, so an ID on its own is a complete search. Omitting it here made such a
 * search parse as empty, which is why a saved HigherGov search restored nothing.
 */
const hasAnyCriteria = (p: URLSearchParams): boolean =>
  p.has('q') || p.has('source') || p.has('naics') || p.has('setAside') || p.has('from') || p.has('hgId');

export const paramsToFormValues = (p: URLSearchParams): Partial<FormValues> | null => {
  if (!hasAnyCriteria(p)) return null;
  const parseDate = (s: string | null) => s ? new Date(s) : undefined;
  return {
    keywords: p.get('q') ?? '',
    source: (p.get('source') as FormValues['source']) ?? 'all',
    naics: p.get('naics')?.split(',').filter(Boolean) ?? [],
    setAsideCode: p.get('setAside') ?? '',
    postedFrom: parseDate(p.get('from')),
    postedTo: parseDate(p.get('to')),
    closingFrom: parseDate(p.get('closingFrom')),
    closingTo: parseDate(p.get('closingTo')),
    higherGovSourceType: (p.get('hgSource') ?? '') as FormValues['higherGovSourceType'],
    higherGovSearchId: p.get('hgId') ?? '',
  };
};

export const paramsToCriteria = (p: URLSearchParams): SearchOpportunityCriteria | null => {
  if (!hasAnyCriteria(p)) return null;
  const source = p.get('source') as 'SAM_GOV' | 'DIBBS' | 'HIGHER_GOV' | null;
  return {
    keywords:            p.get('q') ?? undefined,
    sources:             source ? [source] : undefined,
    naics:               p.get('naics')?.split(',').filter(Boolean) ?? undefined,
    setAsideCode:        p.get('setAside') ?? undefined,
    postedFrom:          p.get('from') ?? undefined,
    postedTo:            p.get('to') ?? undefined,
    closingFrom:         p.get('closingFrom') ?? undefined,
    closingTo:           p.get('closingTo') ?? undefined,
    higherGovSourceType: p.get('hgSource') ?? undefined,
    higherGovSearchId:   p.get('hgId') ?? undefined,
    limit:               p.has('limit') ? Number(p.get('limit')) : DEFAULT_LIMIT,
  };
};
