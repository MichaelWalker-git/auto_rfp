'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Filter,
  Loader2,
  Search,
  X,
} from 'lucide-react';

import type { LoadSamOpportunitiesRequest, SamOpportunitySlim } from '@auto-rfp/shared';
import { useSearchOpportunities } from '@/lib/hooks/use-opportunities';

function mmddyyyy(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

function defaultDateRange(daysBack = 14) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - daysBack);
  return { postedFrom: mmddyyyy(from), postedTo: mmddyyyy(to) };
}

function fmtDate(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function safeUrl(desc?: string): string | null {
  if (!desc) return null;
  try {
    return new URL(desc).toString();
  } catch {
    return null;
  }
}

const QUICK_FILTERS = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
];

export default function SamGovOpportunitySearch() {
  const { toast } = useToast();
  const { data, isMutating: isLoading, error, trigger: search } = useSearchOpportunities();

  const initial = React.useMemo(() => defaultDateRange(14), []);
  const [keywords, setKeywords] = React.useState('');
  const [naicsCsv, setNaicsCsv] = React.useState('541511');
  const [agencyName, setAgencyName] = React.useState('');
  const [setAsideCode, setSetAsideCode] = React.useState('');
  const [ptypeCsv, setPtypeCsv] = React.useState('');
  const [postedFrom, setPostedFrom] = React.useState(initial.postedFrom);
  const [postedTo, setPostedTo] = React.useState(initial.postedTo);
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const naics = React.useMemo(
    () => naicsCsv.split(',').map((s) => s.trim()).filter(Boolean),
    [naicsCsv],
  );

  const ptype = React.useMemo(
    () => ptypeCsv.split(',').map((s) => s.trim()).filter(Boolean),
    [ptypeCsv],
  );

  React.useEffect(() => {
    if (error) {
      toast({
        title: 'SAM.gov search failed',
        description: typeof error === 'string' ? error : (error as any)?.message ?? String(error),
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  const doSearch = async (offset = 0) => {
    const req: LoadSamOpportunitiesRequest = {
      postedFrom,
      postedTo,
      keywords: keywords.trim() || undefined,
      naics: naics.length ? naics : undefined,
      organizationName: agencyName.trim() || undefined,
      setAsideCode: setAsideCode.trim() || undefined,
      ptype: ptype.length ? ptype : undefined,
      limit: 25,
      offset,
    } as any;

    await search(req);
  };

  const applyQuickFilter = (days: number) => {
    const range = defaultDateRange(days);
    setPostedFrom(range.postedFrom);
    setPostedTo(range.postedTo);
  };

  const clearFilters = () => {
    setKeywords('');
    setNaicsCsv('541511');
    setAgencyName('');
    setSetAsideCode('');
    setPtypeCsv('');
    const range = defaultDateRange(14);
    setPostedFrom(range.postedFrom);
    setPostedTo(range.postedTo);
  };

  const activeFilterCount = [
    keywords.trim(),
    agencyName.trim(),
    setAsideCode.trim(),
    ptypeCsv.trim(),
    // naics is always present by default; don’t count it unless it differs from default:
    naicsCsv.trim() !== '541511' ? 'naics' : '',
  ].filter(Boolean).length;

  const results = data?.opportunities ?? [];
  const offset = data?.offset ?? 0;
  const limit = data?.limit ?? 25;
  const total = data?.totalRecords ?? 0;

  const canPrev = offset > 0;
  const canNext = offset + limit < total;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isLoading) doSearch(0);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      {/* Page header */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Search className="h-6 w-6 text-primary" />
            Opportunities
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search SAM.gov and import solicitations into your pipeline.
          </p>
        </div>

        {/* optional: right-side actions later (Saved searches, Alerts, etc.) */}
        {/* <Button variant="outline">Saved searches</Button> */}
      </div>

      {/* Search + filters container */}
      <Card className="rounded-2xl">
        <CardContent className="p-4 md:p-5 space-y-4">
          {/* Main search row */}
          <div className="flex flex-col gap-2 md:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Keywords (e.g., cloud migration, devsecops)…"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                onKeyDown={handleKeyDown}
                className="pl-10 h-11"
              />
            </div>

            <div className="flex gap-2">
              <Button onClick={() => doSearch(0)} disabled={isLoading} className="h-11">
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Search
              </Button>

              <Button
                variant="outline"
                className="h-11"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                <Filter className="mr-2 h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFilterCount}
                  </Badge>
                )}
                {showAdvanced ? <ChevronUp className="ml-2 h-4 w-4" /> : <ChevronDown className="ml-2 h-4 w-4" />}
              </Button>
            </div>
          </div>

          {/* Quick filters */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Date:</span>
            {QUICK_FILTERS.map((f) => (
              <Button
                key={f.days}
                variant="outline"
                size="sm"
                onClick={() => applyQuickFilter(f.days)}
                className="h-8"
              >
                <Calendar className="mr-1 h-3.5 w-3.5" />
                {f.label}
              </Button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span>From</span>
              <span className="font-medium text-foreground">{postedFrom}</span>
              <span>to</span>
              <span className="font-medium text-foreground">{postedTo}</span>
            </div>
          </div>

          {/* Advanced filters */}
          {showAdvanced && (
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    NAICS codes
                  </Label>
                  <Input
                    value={naicsCsv}
                    onChange={(e) => setNaicsCsv(e.target.value)}
                    placeholder="541511, 541512"
                  />
                  <p className="text-xs text-muted-foreground">Comma-separated</p>
                </div>

                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Building2 className="h-4 w-4" />
                    Agency name
                  </Label>
                  <Input
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    placeholder="Department of Defense"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Set-aside code</Label>
                  <Input
                    value={setAsideCode}
                    onChange={(e) => setSetAsideCode(e.target.value)}
                    placeholder="8A, SDVOSB, HUBZone…"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Procurement type (ptype)</Label>
                  <Input
                    value={ptypeCsv}
                    onChange={(e) => setPtypeCsv(e.target.value)}
                    placeholder="Comma-separated"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Posted from</Label>
                  <Input value={postedFrom} onChange={(e) => setPostedFrom(e.target.value)} placeholder="MM/DD/YYYY" />
                </div>

                <div className="space-y-2">
                  <Label>Posted to</Label>
                  <Input value={postedTo} onChange={(e) => setPostedTo(e.target.value)} placeholder="MM/DD/YYYY" />
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" onClick={clearFilters} className="w-full sm:w-auto">
                  <X className="mr-2 h-4 w-4" />
                  Reset filters
                </Button>
                <div className="sm:ml-auto text-xs text-muted-foreground self-center">
                  Tip: keep NAICS narrow for better results.
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results summary */}
      <div className="mt-5">
        {data && (
          <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
            <div className="text-sm">
              {total === 0 ? (
                <span className="text-muted-foreground">No opportunities found.</span>
              ) : (
                <>
                  Showing{' '}
                  <span className="font-semibold">
                    {Math.min(total, offset + 1)}–{Math.min(total, offset + results.length)}
                  </span>{' '}
                  of <span className="font-semibold">{total.toLocaleString()}</span>
                </>
              )}
            </div>

            {total > limit && (
              <div className="text-sm text-muted-foreground">
                Page {Math.floor(offset / limit) + 1} / {Math.max(1, Math.ceil(total / limit))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="mt-4 space-y-3">
        {isLoading && !data && (
          <div className="flex items-center justify-center rounded-xl border py-12">
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Searching SAM.gov…
            </div>
          </div>
        )}

        {data && results.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
            <Search className="h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">No matches</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try expanding your date range or adjusting NAICS/keywords.
            </p>
          </div>
        )}

        {results.map((o: SamOpportunitySlim) => {
          const link = safeUrl(o.description);
          const isActive = o.active === 'Yes' || (o.active as any) === true;

          return (
            <Card
              key={o.noticeId ?? `${o.solicitationNumber}-${o.postedDate}-${o.title}`}
              className="rounded-2xl transition-shadow hover:shadow-md"
            >
              <CardContent className="p-4 md:p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-base font-semibold">
                        {o.title ?? '(No title)'}
                      </h3>
                      {isActive && <Badge className="shrink-0">Active</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Notice: {o.noticeId ?? '—'}</span>
                      <span>•</span>
                      <span>Sol: {o.solicitationNumber ?? '—'}</span>
                    </div>
                  </div>

                  {link && (
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary hover:underline shrink-0"
                    >
                      View <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>

                <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">Posted:</span>
                    <span className="font-medium">{fmtDate(o.postedDate) || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-destructive" />
                    <span className="text-muted-foreground">Due:</span>
                    <span className="font-medium">{fmtDate(o.responseDeadLine) || '—'}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">NAICS:</span>
                    <Badge variant="outline">{o.naicsCode ?? '—'}</Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">PSC:</span>
                    <Badge variant="outline">{o.classificationCode ?? '—'}</Badge>
                  </div>

                  {(o.setAsideCode || o.setAside) && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-muted-foreground">Set-aside:</span>
                      <Badge variant="secondary">{o.setAsideCode ?? o.setAside}</Badge>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 pt-3 border-t sm:flex-row sm:items-center">
                  <Button
                    size="sm"
                    onClick={() =>
                      toast({
                        title: 'Import not implemented yet',
                        description: `Next lambda: import-solicitation for noticeId=${o.noticeId ?? '—'}`,
                      })
                    }
                  >
                    Import solicitation
                  </Button>

                  <div className="text-xs text-muted-foreground sm:ml-auto">
                    Add saved searches + alerts next.
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pagination */}
      {data && total > limit && (
        <div className="mt-5 flex items-center justify-between border-t pt-4">
          <Button
            variant="outline"
            disabled={!canPrev || isLoading}
            onClick={() => doSearch(Math.max(0, offset - limit))}
          >
            Previous
          </Button>
          <div className="text-sm text-muted-foreground">
            Page {Math.floor(offset / limit) + 1} of {Math.max(1, Math.ceil(total / limit))}
          </div>
          <Button
            variant="outline"
            disabled={!canNext || isLoading}
            onClick={() => doSearch(offset + limit)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
