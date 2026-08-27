'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, subDays } from 'date-fns';
import {
  Bookmark, BookmarkPlus, CalendarIcon, Check, ChevronDown,
  Loader2, Search, SlidersHorizontal, X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList,
} from '@/components/ui/command';
import {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { useToast } from '@/components/ui/use-toast';
import { NAICS_CODES, SET_ASIDE_CODES } from '@/lib/constants/naics-codes';
import type { SearchOpportunityCriteria } from '@/lib/hooks/use-search-opportunities';
import { useListSavedSearches } from '@/lib/hooks/use-saved-search';
import type { SavedSearch } from '@auto-rfp/core';

// ─── Schema ───────────────────────────────────────────────────────────────────

/**
 * Providers the UI offers. DIBBS is deliberately absent: it is still wired end to
 * end in the backend (handlers, routes, saved-search runner) and previously-saved
 * DIBBS searches keep running, but it is not a provider this product can actually
 * use — offering it only produced empty result sets with no explanation.
 *
 * `all` is gone too. The three providers support wildly different filters, so a
 * combined search silently dropped most of what the user typed for at least one of
 * them. Filters are now provider-aware, which requires a single chosen provider.
 */
const SOURCE_LABELS = {
  SAM_GOV: 'SAM.gov',
  HIGHER_GOV: 'HigherGov',
} as const satisfies Record<string, string>;

const Schema = z.object({
  keywords:     z.string().optional(),
  source:       z.enum(['SAM_GOV', 'HIGHER_GOV']).default('SAM_GOV'),
  naics:        z.array(z.string()).default([]),
  setAsideCode: z.string().default(''),
  postedFrom:   z.date().optional(),
  postedTo:     z.date().optional(),
  closingFrom:  z.date().optional(),
  closingTo:    z.date().optional(),
  higherGovSourceType: z.enum(['', 'sam', 'dibbs', 'sbir', 'grant', 'sled']).default(''),
  /** HigherGov search_id — replay a saved search from HigherGov UI */
  higherGovSearchId: z.string().default(''),
});
export type FormValues = z.input<typeof Schema>;

const DEFAULTS: FormValues = {
  keywords: '', source: 'SAM_GOV', naics: [], setAsideCode: '',
  postedFrom: subDays(new Date(), 30), postedTo: new Date(),
  closingFrom: undefined, closingTo: undefined,
  higherGovSourceType: '',
  higherGovSearchId: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mmddToDate = (s?: string) => {
  if (!s) return undefined;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  // Built from parts rather than parsed from a string: `new Date('2026-07-06')` is
  // UTC midnight, which renders as the 5th anywhere west of UTC.
  return m ? new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2])) : undefined;
};

/**
 * Calendar day as `yyyy-MM-dd`, taken from the local date rather than via
 * `toISOString()`, which converts to UTC first and so reports the previous day for
 * users ahead of UTC (Tokyo, Sydney, Auckland).
 */
const toLocalIsoDate = (d?: Date): string | undefined =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : undefined;

const fmtShort = (d?: Date) => d ? format(d, 'MMM d') : '—';

// ─── Date range popover ───────────────────────────────────────────────────────

const DateRangeFilter = ({
  label, from, to, onFromChange, onToChange,
}: {
  label: string;
  from: Date | undefined; to: Date | undefined;
  onFromChange: (d: Date | undefined) => void;
  onToChange: (d: Date | undefined) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  const active = !!(from || to);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" size="sm"
          className={cn('h-8 gap-1.5 text-xs font-normal', active && 'border-primary bg-primary/5 text-primary font-medium')}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {active ? `${fmtShort(from)} – ${fmtShort(to)}` : label}
          {active
            ? <span onClick={e => { e.stopPropagation(); onFromChange(undefined); onToChange(undefined); }} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></span>
            : <ChevronDown className="h-3 w-3 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-4" align="start">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">{label}</p>
        <div className="flex gap-4">
          <div><p className="text-xs text-muted-foreground mb-1">From</p>
            <Calendar mode="single" selected={from} onSelect={onFromChange} disabled={d => !!(to && d > to)} initialFocus />
          </div>
          <div><p className="text-xs text-muted-foreground mb-1">To</p>
            <Calendar mode="single" selected={to} onSelect={onToChange} disabled={d => !!(from && d < from)} />
          </div>
        </div>
        <div className="flex gap-1.5 mt-3 pt-3 border-t">
          {[7, 30, 90].map(days => (
            <Button key={days} type="button" variant="outline" size="sm" className="h-7 text-xs flex-1"
              onClick={() => { onFromChange(subDays(new Date(), days)); onToChange(new Date()); setOpen(false); }}>
              Last {days}d
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// ─── Single-day picker ────────────────────────────────────────────────────────

/**
 * HigherGov's `/opportunity/` takes a single `posted_date` day rather than a range,
 * so showing a two-ended range picker for it would imply a filter the API cannot
 * honour — the "To" half was previously collected and discarded.
 */
const SingleDateFilter = ({
  label, value, onChange,
}: {
  label: string;
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button" variant="outline" size="sm"
          className={cn('h-8 gap-1.5 text-xs font-normal', !!value && 'border-primary bg-primary/5 text-primary font-medium')}
        >
          <CalendarIcon className="h-3.5 w-3.5" />
          {value ? fmtShort(value) : label}
          {value
            ? <span role="button" tabIndex={0} aria-label={`Clear ${label}`} onClick={e => { e.stopPropagation(); onChange(undefined); }} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onChange(undefined); } }} className="ml-0.5 hover:text-destructive cursor-pointer"><X className="h-3 w-3" /></span>
            : <ChevronDown className="h-3 w-3 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-4" align="start">
        <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wide">{label}</p>
        <Calendar mode="single" selected={value} onSelect={d => { onChange(d); setOpen(false); }} initialFocus />
      </PopoverContent>
    </Popover>
  );
};

// ─── NAICS multi-select ───────────────────────────────────────────────────────

const NaicsFilter = ({ selected, onChange }: { selected: string[]; onChange: (v: string[]) => void }) => {
  const [open, setOpen] = React.useState(false);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const categories = React.useMemo(() => {
    const m = new Map<string, typeof NAICS_CODES>();
    for (const o of NAICS_CODES) { const c = o.category ?? 'Other'; if (!m.has(c)) m.set(c, []); m.get(c)!.push(o); }
    return m;
  }, []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm"
          className={cn('h-8 gap-1.5 text-xs font-normal', selected.length > 0 && 'border-primary bg-primary/5 text-primary font-medium')}>
          {selected.length > 0 ? `NAICS: ${selected.length}` : 'NAICS'}
          {selected.length > 0
            ? <span onClick={e => { e.stopPropagation(); onChange([]); }} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></span>
            : <ChevronDown className="h-3 w-3 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search NAICS codes…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            {Array.from(categories.entries()).map(([cat, items]) => (
              <CommandGroup key={cat} heading={cat}>
                {items.map(opt => {
                  const sel = selected.includes(opt.value);
                  return (
                    <CommandItem key={opt.value} value={opt.label} onSelect={() => toggle(opt.value)} className="cursor-pointer">
                      <div className={cn('mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary', sel ? 'bg-primary text-primary-foreground' : 'opacity-50')}>
                        {sel && <Check className="h-3 w-3" />}
                      </div>
                      <span className="text-xs">{opt.label}</span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))}
          </CommandList>
          {selected.length > 0 && (
            <div className="border-t p-2">
              <Button type="button" variant="ghost" size="sm" className="w-full text-xs h-7" onClick={() => { onChange([]); setOpen(false); }}>
                <X className="mr-1.5 h-3 w-3" />Clear ({selected.length})
              </Button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// ─── Recent searches ──────────────────────────────────────────────────────────

const RecentSearches = ({ orgId, onApply }: { orgId: string; onApply: (s: SavedSearch) => void }) => {
  const [open, setOpen] = React.useState(false);
  const { items, isLoading } = useListSavedSearches({ orgId, limit: 10 });
  if (!isLoading && !items.length) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-10 px-3 shrink-0 text-sm gap-1.5 text-muted-foreground hover:text-foreground">
          <BookmarkPlus className="h-4 w-4" />Recent
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command>
          <CommandInput placeholder="Filter saved searches…" />
          <CommandList>
            {isLoading && <div className="py-3 text-center text-xs text-muted-foreground">Loading…</div>}
            <CommandEmpty>No saved searches.</CommandEmpty>
            <CommandGroup heading="Saved searches">
              {items.map(s => (
                <CommandItem key={s.savedSearchId} value={s.name} onSelect={() => { onApply(s); setOpen(false); }} className="cursor-pointer flex-col items-start gap-0.5 py-2">
                  <div className="flex items-center gap-2 w-full">
                    <span className="font-medium text-sm truncate">{s.name}</span>
                    <Badge variant="outline" className="ml-auto text-xs h-5 shrink-0">{s.source ?? 'SAM.gov'}</Badge>
                  </div>
                  {s.criteria.keywords && <p className="text-xs text-muted-foreground truncate w-full">"{s.criteria.keywords}"</p>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};

// ─── HigherGov search_id ─────────────────────────────────────────────────────

/**
 * Accepts either a bare Search ID or a full HigherGov URL containing `searchID=`,
 * so a user can paste straight from their browser's address bar.
 *
 * This used to live behind an "Apply" popover; the ID is now the primary HigherGov
 * input, since it is that provider's only real filter.
 */
export const extractSearchId = (input: string): string => {
  const match = /searchID=([^&]+)/.exec(input);
  return match ? match[1] : input.trim();
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  orgId?: string;
  /** Project a saved search auto-imports into when run on schedule. */
  projectId?: string;
  onSearch: (c: SearchOpportunityCriteria) => void;
  isLoading: boolean;
  /** Initial filter values restored from URL search params */
  initialValues?: Partial<FormValues>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const SearchOpportunityForm = ({ orgId, projectId, onSearch, isLoading, initialValues }: Props) => {
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState('My Search');
  const [isSaving, setIsSaving] = React.useState(false);

  // Explicit `undefined`s are stripped before the spread. `paramsToFormValues`
  // returns a key for every field, so a URL without `from`/`to` used to overwrite
  // the 30-day default with `undefined` — the date chip then read "Posted date"
  // (i.e. unfiltered) while the hook still applied a 30-day window underneath.
  const mergedDefaults = React.useMemo(() => {
    const provided = Object.fromEntries(
      Object.entries(initialValues ?? {}).filter(([, v]) => v !== undefined),
    ) as Partial<FormValues>;
    return { ...DEFAULTS, ...provided };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only use initial mount values

  const { control, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
    resolver: zodResolver(Schema), defaultValues: mergedDefaults,
  });
  const w = watch();

  const isSamGov = w.source === 'SAM_GOV';
  const isHigherGov = w.source === 'HIGHER_GOV';

  // Only counts filters that are actually live for the chosen provider, so the
  // "Reset N" badge can never advertise a filter the provider ignores.
  const activeCount = isSamGov
    ? [
        !!w.keywords?.trim(), (w.naics?.length ?? 0) > 0, !!w.setAsideCode,
        !!(w.closingFrom || w.closingTo),
      ].filter(Boolean).length
    : [
        !!w.higherGovSearchId?.trim(), !!w.higherGovSourceType,
      ].filter(Boolean).length;

  /**
   * Emits only the criteria the chosen provider can honour.
   *
   * Previously every field was sent for every provider, so HigherGov received
   * keyword/NAICS/set-aside values its API has no parameters for — the backend then
   * client-filtered a 100-row slice, which reads as "filtering is broken". SAM.gov
   * likewise received HigherGov-only fields it ignores.
   */
  const buildCriteria = (v: FormValues): SearchOpportunityCriteria => {
    const base = {
      sources: [v.source] as SearchOpportunityCriteria['sources'],
      limit: 25,
    };

    if (v.source === 'HIGHER_GOV') {
      return {
        ...base,
        // A search_id encodes its own keywords, filters and date range.
        higherGovSearchId: v.higherGovSearchId?.trim() || undefined,
        higherGovSourceType: v.higherGovSourceType || undefined,
        postedFrom: toLocalIsoDate(v.postedFrom),
      };
    }

    return {
      ...base,
      // SAM.gov matches this against notice TITLES only — `/opportunities/v2/search`
      // has no free-text parameter. Labelled accordingly in the UI.
      keywords:     v.keywords?.trim() || undefined,
      naics:        v.naics?.length ? v.naics : undefined,
      setAsideCode: v.setAsideCode || undefined,
      postedFrom:   toLocalIsoDate(v.postedFrom),
      postedTo:     toLocalIsoDate(v.postedTo),
      closingFrom:  toLocalIsoDate(v.closingFrom),
      closingTo:    toLocalIsoDate(v.closingTo),
    };
  };

  const applySearch = (s: SavedSearch) => {
    const c = s.criteria;
    // A stored DIBBS search maps onto SAM.gov: DIBBS is no longer offered in the UI,
    // and leaving `source` unset would strand the form on an unselectable provider.
    const source = s.source === 'HIGHER_GOV' ? 'HIGHER_GOV' : 'SAM_GOV';
    reset({
      keywords: c.keywords ?? '', source,
      naics: c.naics ?? [], setAsideCode: c.setAsideCode ?? '',
      postedFrom: mmddToDate(c.postedFrom), postedTo: mmddToDate(c.postedTo),
      closingFrom: mmddToDate(c.closingFrom), closingTo: mmddToDate(c.closingTo),
      higherGovSourceType: (c.higherGovSourceType ?? '') as FormValues['higherGovSourceType'],
      higherGovSearchId: c.higherGovSearchId ?? '',
    });
  };

  const handleSave = async () => {
    if (!orgId) return;
    setIsSaving(true);
    try {
      const c = buildCriteria(w);
      const fmt = (iso?: string) => iso ? `${iso.slice(5,7)}/${iso.slice(8,10)}/${iso.slice(0,4)}` : '01/01/2025';
      const source = w.source === 'HIGHER_GOV' ? 'HIGHER_GOV' : 'SAM_GOV';
      // Daily auto-import is scoped to HigherGov: its saved-search IDs pull a
      // stable, filtered result set, so unattended daily imports are safe. SAM.gov
      // stays opt-out (autoImport false) to avoid flooding a project.
      const autoImport = source === 'HIGHER_GOV';
      const res = await authFetcher(`${env.BASE_API_URL}/search-opportunities/saved-search`, {
        method: 'POST',
        body: JSON.stringify({
          source, orgId,
          name: saveName.trim() || 'My Search',
          criteria: { postedFrom: fmt(c.postedFrom), postedTo: fmt(c.postedTo), keywords: c.keywords, naics: c.naics, setAsideCode: c.setAsideCode, closingFrom: c.closingFrom ? fmt(c.closingFrom) : undefined, closingTo: c.closingTo ? fmt(c.closingTo) : undefined, higherGovSourceType: c.higherGovSourceType, higherGovSearchId: c.higherGovSearchId },
          projectId,
          frequency: 'DAILY', autoImport, notifyEmails: [], isEnabled: true,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      toast({
        title: 'Search saved',
        description: autoImport && projectId
          ? `"${saveName}" will run daily and import new matches into this project.`
          : `"${saveName}" will run daily.`,
      });
      setSaveOpen(false);
    } catch { toast({ title: 'Failed to save', variant: 'destructive' }); }
    finally { setIsSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit(v => onSearch(buildCriteria(v)))} className="space-y-2">

      {/* ── Row 1: primary input + actions ── */}
      <div className="flex gap-2">
        {/* SAM.gov: title search. HigherGov: its Search ID, which is that provider's
            only real filter — so it takes the primary slot rather than a chip. */}
        <div className="relative flex-1">
          {isSamGov ? (
            <>
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Controller name="keywords" control={control} render={({ field }) => (
                <Input
                  {...field}
                  placeholder="Title contains… (SAM.gov matches notice titles only)"
                  className="pl-10 h-10"
                />
              )} />
            </>
          ) : (
            <>
              <Bookmark className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Controller name="higherGovSearchId" control={control} render={({ field }) => (
                <Input
                  {...field}
                  onChange={e => field.onChange(extractSearchId(e.target.value))}
                  placeholder="Paste a HigherGov search URL or Search ID…"
                  className="pl-10 h-10"
                />
              )} />
            </>
          )}
        </div>
        <Button type="submit" disabled={isLoading} className="h-10 px-5 shrink-0">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          <span className="ml-2">Search</span>
        </Button>
        {orgId && (
          <>
            <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
              <DialogTrigger asChild>
                <Button type="button" variant="outline" className="h-10 px-3 shrink-0" title="Save search">
                  <BookmarkPlus className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Save search</DialogTitle><DialogDescription>Save this search to run automatically on a schedule.</DialogDescription></DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2"><Label>Name</Label><Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="My Search" /></div>
                  <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">Saves current keywords, date range, NAICS, and set-aside filters. Runs daily.</div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button type="button" variant="outline" disabled={isSaving}>Cancel</Button></DialogClose>
                  <Button type="button" onClick={handleSave} disabled={isSaving}>{isSaving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</> : 'Save search'}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <RecentSearches orgId={orgId} onApply={applySearch} />
          </>
        )}
      </div>

      {/* ── Row 2: filter chips ── */}
      <div className="flex flex-wrap items-center gap-1.5">

        {/* Provider — always the first chip, since every other filter depends on it */}
        <Controller name="source" control={control} render={({ field }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm"
                className="h-8 gap-1.5 text-xs font-medium border-primary bg-primary/5 text-primary">
                {SOURCE_LABELS[field.value as keyof typeof SOURCE_LABELS] ?? 'SAM.gov'}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuLabel className="text-xs">Provider</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={field.value} onValueChange={field.onChange}>
                <DropdownMenuRadioItem value="SAM_GOV" className="text-xs">SAM.gov</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="HIGHER_GOV" className="text-xs">HigherGov</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )} />

        {/* HigherGov source_type filter — only visible when HigherGov is selected */}
        {isHigherGov && (
          <Controller name="higherGovSourceType" control={control} render={({ field }) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm"
                  className={cn('h-8 gap-1.5 text-xs font-normal', !!field.value && 'border-primary bg-primary/5 text-primary font-medium')}>
                  {field.value ? ({ sam: 'SAM.gov', dibbs: 'DIBBS', sbir: 'SBIR/STTR', grant: 'Grants', sled: 'State & Local' }[field.value] ?? field.value) : 'HGov Source'}
                  {field.value
                    ? <span onClick={e => { e.stopPropagation(); field.onChange(''); }} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></span>
                    : <ChevronDown className="h-3 w-3 opacity-50" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuLabel className="text-xs">HigherGov Source</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuRadioGroup value={field.value || 'any'} onValueChange={v => field.onChange(v === 'any' ? '' : v)}>
                  <DropdownMenuRadioItem value="any" className="text-xs">All sources</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="sbir" className="text-xs">SBIR/STTR</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="grant" className="text-xs">Grants</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="sled" className="text-xs">State & Local</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="sam" className="text-xs">SAM.gov</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="dibbs" className="text-xs">DIBBS</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )} />
        )}

        {/* NAICS — SAM.gov `ncode`. HigherGov's API has no NAICS parameter. */}
        {isSamGov && (
        <Controller name="naics" control={control} render={({ field }) => (
          <NaicsFilter selected={field.value ?? []} onChange={field.onChange} />
        )} />
        )}

        {/* Set-aside — SAM.gov `setAsideCode`. Unsupported by HigherGov's API. */}
        {isSamGov && (
        <Controller name="setAsideCode" control={control} render={({ field }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm"
                className={cn('h-8 gap-1.5 text-xs font-normal', !!field.value && 'border-primary bg-primary/5 text-primary font-medium')}>
                {field.value ? SET_ASIDE_CODES.find(o => o.value === field.value)?.label ?? field.value : 'Set-aside'}
                {field.value
                  ? <span onClick={e => { e.stopPropagation(); field.onChange(''); }} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></span>
                  : <ChevronDown className="h-3 w-3 opacity-50" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56 max-h-64 overflow-y-auto">
              <DropdownMenuLabel className="text-xs">Set-aside</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={field.value || 'any'} onValueChange={v => field.onChange(v === 'any' ? '' : v)}>
                <DropdownMenuRadioItem value="any" className="text-xs">Any set-aside</DropdownMenuRadioItem>
                {SET_ASIDE_CODES.map(o => <DropdownMenuRadioItem key={o.value} value={o.value} className="text-xs">{o.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )} />
        )}

        {/* Posted date — SAM.gov honours the full range (`postedFrom`/`postedTo`);
            HigherGov takes a single `posted_date` day, so it gets a one-day picker. */}
        {isSamGov ? (
          <Controller name="postedFrom" control={control} render={({ field: f1 }) => (
            <Controller name="postedTo" control={control} render={({ field: f2 }) => (
              <DateRangeFilter label="Posted date" from={f1.value} to={f2.value} onFromChange={f1.onChange} onToChange={f2.onChange} />
            )} />
          )} />
        ) : (
          <Controller name="postedFrom" control={control} render={({ field }) => (
            <SingleDateFilter label="Posted on" value={field.value} onChange={field.onChange} />
          )} />
        )}

        {/* Closing date — SAM.gov `rdlfrom`/`rdlto`. HigherGov's API has no
            response-deadline filter, so this stays hidden for it. */}
        {isSamGov && (
          <Controller name="closingFrom" control={control} render={({ field: f1 }) => (
            <Controller name="closingTo" control={control} render={({ field: f2 }) => (
              <DateRangeFilter label="Closing date" from={f1.value} to={f2.value} onFromChange={f1.onChange} onToChange={f2.onChange} />
            )} />
          )} />
        )}

        {/* Divider + reset */}
        {activeCount > 0 && (
          <>
            <div className="h-4 w-px bg-border mx-0.5" />
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-destructive gap-1" onClick={() => reset(DEFAULTS)}>
              <X className="h-3 w-3" />
              Reset {activeCount}
            </Button>
          </>
        )}

        {/* Active NAICS chips */}
        {isSamGov && (w.naics ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 ml-1">
            {(w.naics ?? []).map(code => (
              <Badge key={code} variant="secondary" className="text-xs h-6 px-1.5 gap-1 font-normal">
                {code}
                <button type="button" onClick={() => setValue('naics', (w.naics ?? []).filter(v => v !== code))} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ── Provider capability note ──
          Replaces the old amber "this search is doomed" warning. That warning fired
          after the user had already typed a keyword HigherGov cannot honour; the
          filters above are now provider-aware, so the doomed combination is
          unreachable and only an explanation of the remaining shape is needed. */}
      {isHigherGov && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            HigherGov's API filters by saved search only — build the search on{' '}
            <a href="https://www.highergov.com" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">HigherGov</a>{' '}
            (keywords, NAICS, set-asides and all), then paste its URL or Search ID above.
            Leave it empty to browse the most recently captured opportunities.
          </span>
        </p>
      )}
    </form>
  );
};
