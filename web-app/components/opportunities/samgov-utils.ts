import type { SamGovFiltersState } from '@/components/opportunities/samgov-filters';
import type { LoadSamOpportunitiesRequest } from '@auto-rfp/shared';

export function mmddyyyy(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export function defaultDateRange(daysBack = 14) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - daysBack);
  return { postedFrom: mmddyyyy(from), postedTo: mmddyyyy(to) };
}

export function fmtDate(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function safeUrl(desc?: string): string | null {
  if (!desc) return null;
  try {
    return new URL(desc).toString();
  } catch {
    return null;
  }
}

export const QUICK_FILTERS = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
];

export function reqToFiltersState(
  req: Partial<LoadSamOpportunitiesRequest>,
  fallback: { postedFrom: string; postedTo: string },
): SamGovFiltersState {
  // Map request -> UI filters
  return {
    keywords: (req.keywords ?? '') as string,
    naicsCsv: Array.isArray(req.naics) && req.naics.length ? req.naics.join(',') : '541511',
    agencyName: (req.organizationName ?? '') as string,
    setAsideCode: (req.setAsideCode ?? '') as string,
    ptypeCsv: Array.isArray(req.ptype) && req.ptype.length ? req.ptype.join(',') : '',
    postedFrom: (req.postedFrom ?? fallback.postedFrom) as string,
    postedTo: (req.postedTo ?? fallback.postedTo) as string,
  };
}

export function safeDecodeSearchParam(raw: string): any | null {
  try {
    const decoded = decodeURIComponent(raw);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}


export function filtersToRequest(
  filters: SamGovFiltersState,
  opts?: { limit?: number; offset?: number },
): LoadSamOpportunitiesRequest {
  const naics = filters.naicsCsv.split(',').map((s) => s.trim()).filter(Boolean);
  const ptype = filters.ptypeCsv.split(',').map((s) => s.trim()).filter(Boolean);

  return {
    postedFrom: filters.postedFrom,
    postedTo: filters.postedTo,
    keywords: filters.keywords.trim() || undefined,
    naics: naics.length ? naics : undefined,
    organizationName: filters.agencyName.trim() || undefined,
    setAsideCode: filters.setAsideCode.trim() || undefined,
    ptype: ptype.length ? ptype : undefined,
    limit: opts?.limit ?? 25,
    offset: opts?.offset ?? 0,
  } as any;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

// Your app currently uses MM/DD/YYYY strings in state
function dateToMmddyyyy(d: Date) {
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}