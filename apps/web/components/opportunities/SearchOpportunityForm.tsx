'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, subDays } from 'date-fns';
import {
  BookmarkPlus, CalendarIcon, Check, ChevronDown,
  ChevronsUpDown, Loader2, Search, SlidersHorizontal, X,
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

const Schema = z.object({
  keywords:     z.string().optional(),
  source:       z.enum(['all', 'SAM_GOV', 'DIBBS']).default('all'),
  naics:        z.array(z.string()).default([]),
  setAsideCode: z.string().default(''),
  postedFrom:   z.date().optional(),
  postedTo:     z.date().optional(),
  closingFrom:  z.date().optional(),
  closingTo:    z.date().optional(),
});
type FormValues = z.input<typeof Schema>;

const DEFAULTS: FormValues = {
  keywords: '', source: 'all', naics: [], setAsideCode: '',
  postedFrom: subDays(new Date(), 30), postedTo: new Date(),
  closingFrom: undefined, closingTo: undefined,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mmddToDate = (s?: string) => {
  if (!s) return undefined;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? new Date(`${m[3]}-${m[1]}-${m[2]}`) : undefined;
};

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
        <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground gap-1">
          <BookmarkPlus className="h-3.5 w-3.5" />Recent
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

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props { orgId?: string; onSearch: (c: SearchOpportunityCriteria) => void; isLoading: boolean; }

// ─── Component ────────────────────────────────────────────────────────────────

export const SearchOpportunityForm = ({ orgId, onSearch, isLoading }: Props) => {
  const { toast } = useToast();
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState('My Search');
  const [isSaving, setIsSaving] = React.useState(false);

  const { control, handleSubmit, watch, setValue, reset } = useForm<FormValues>({
    resolver: zodResolver(Schema), defaultValues: DEFAULTS,
  });
  const w = watch();

  const activeCount = [
    (w.naics?.length ?? 0) > 0, !!w.setAsideCode, w.source !== 'all',
    !!(w.closingFrom || w.closingTo),
  ].filter(Boolean).length;

  const buildCriteria = (v: FormValues): SearchOpportunityCriteria => ({
    keywords:     v.keywords?.trim() || undefined,
    naics:        v.naics?.length ? v.naics : undefined,
    setAsideCode: v.setAsideCode || undefined,
    sources:      v.source !== 'all' ? [v.source as 'SAM_GOV' | 'DIBBS'] : undefined,
    postedFrom:   v.postedFrom?.toISOString().slice(0, 10),
    postedTo:     v.postedTo?.toISOString().slice(0, 10),
    closingFrom:  v.closingFrom?.toISOString().slice(0, 10),
    closingTo:    v.closingTo?.toISOString().slice(0, 10),
    limit: 25,
  });

  const applySearch = (s: SavedSearch) => {
    const c = s.criteria;
    reset({
      keywords: c.keywords ?? '', source: s.source === 'DIBBS' ? 'DIBBS' : 'SAM_GOV',
      naics: c.naics ?? [], setAsideCode: c.setAsideCode ?? '',
      postedFrom: mmddToDate(c.postedFrom), postedTo: mmddToDate(c.postedTo),
      closingFrom: mmddToDate(c.closingFrom), closingTo: mmddToDate(c.closingTo),
    });
  };

  const handleSave = async () => {
    if (!orgId) return;
    setIsSaving(true);
    try {
      const c = buildCriteria(w);
      const fmt = (iso?: string) => iso ? `${iso.slice(5,7)}/${iso.slice(8,10)}/${iso.slice(0,4)}` : '01/01/2025';
      const res = await authFetcher(`${env.BASE_API_URL}/search-opportunities/saved-search`, {
        method: 'POST',
        body: JSON.stringify({
          source: w.source === 'DIBBS' ? 'DIBBS' : 'SAM_GOV', orgId,
          name: saveName.trim() || 'My Search',
          criteria: { postedFrom: fmt(c.postedFrom), postedTo: fmt(c.postedTo), keywords: c.keywords, naics: c.naics, setAsideCode: c.setAsideCode, closingFrom: c.closingFrom ? fmt(c.closingFrom) : undefined, closingTo: c.closingTo ? fmt(c.closingTo) : undefined },
          frequency: 'DAILY', autoImport: false, notifyEmails: [], isEnabled: true,
        }),
      });
      if (!res.ok) throw new Error('Failed');
      toast({ title: 'Search saved', description: `"${saveName}" will run daily.` });
      setSaveOpen(false);
    } catch { toast({ title: 'Failed to save', variant: 'destructive' }); }
    finally { setIsSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit(v => onSearch(buildCriteria(v)))} className="space-y-2">

      {/* ── Row 1: search input + actions ── */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Controller name="keywords" control={control} render={({ field }) => (
            <Input {...field} placeholder="Keywords, solicitation number, technology area…" className="pl-10 h-10" />
          )} />
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

        {/* Source */}
        <Controller name="source" control={control} render={({ field }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm"
                className={cn('h-8 gap-1.5 text-xs font-normal', field.value !== 'all' && 'border-primary bg-primary/5 text-primary font-medium')}>
                {field.value === 'all' ? 'All Sources' : field.value === 'SAM_GOV' ? 'SAM.gov' : 'DIBBS'}
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuLabel className="text-xs">Source</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={field.value} onValueChange={field.onChange}>
                <DropdownMenuRadioItem value="all" className="text-xs">All Sources</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="SAM_GOV" className="text-xs">SAM.gov</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="DIBBS" className="text-xs">DIBBS</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )} />

        {/* NAICS */}
        <Controller name="naics" control={control} render={({ field }) => (
          <NaicsFilter selected={field.value ?? []} onChange={field.onChange} />
        )} />

        {/* Set-aside */}
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

        {/* Posted date */}
        <Controller name="postedFrom" control={control} render={({ field: f1 }) => (
          <Controller name="postedTo" control={control} render={({ field: f2 }) => (
            <DateRangeFilter label="Posted date" from={f1.value} to={f2.value} onFromChange={f1.onChange} onToChange={f2.onChange} />
          )} />
        )} />

        {/* Closing date */}
        <Controller name="closingFrom" control={control} render={({ field: f1 }) => (
          <Controller name="closingTo" control={control} render={({ field: f2 }) => (
            <DateRangeFilter label="Closing date" from={f1.value} to={f2.value} onFromChange={f1.onChange} onToChange={f2.onChange} />
          )} />
        )} />

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
        {(w.naics ?? []).length > 0 && (
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
    </form>
  );
};
