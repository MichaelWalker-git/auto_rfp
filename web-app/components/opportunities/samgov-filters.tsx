'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';

import {
  BookmarkPlus,
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  FileText,
  Filter,
  Loader2,
  Search,
  X,
} from 'lucide-react';

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

import type { CreateSavedSearchRequest, LoadSamOpportunitiesRequest, SavedSearchFrequency, MmDdYyyy} from '@auto-rfp/shared';

import { defaultDateRange, QUICK_FILTERS } from './samgov-utils';
import { useCreateSavedSearch } from '@/lib/hooks/use-saved-search';

export type SamGovFiltersState = {
  keywords: string;
  naicsCsv: string;
  agencyName: string;
  setAsideCode: string;
  ptypeCsv: string;
  postedFrom: string;
  postedTo: string;
  rdlfrom: string;
};

type Props = {
  orgId: string;
  isSearching: boolean;

  value: SamGovFiltersState;
  onChange: (next: SamGovFiltersState) => void;

  activeFilterCount: number;

  onSearch: (req: LoadSamOpportunitiesRequest) => Promise<void>;
};

export function SamGovFilters({
                                orgId,
                                isSearching,
                                value,
                                onChange,
                                activeFilterCount,
                                onSearch,
                              }: Props) {
  const { toast } = useToast();
  const { trigger: createSavedSearch, isMutating: isSavingSearch } = useCreateSavedSearch();

  const [showAdvanced, setShowAdvanced] = React.useState(false);

  // Save Search dialog state
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [saveName, setSaveName] = React.useState('My SAM Search');
  const [saveFrequency, setSaveFrequency] = React.useState<SavedSearchFrequency>('DAILY' as any);
  const [saveAutoImport, setSaveAutoImport] = React.useState(false);
  const [notifyEmailsCsv, setNotifyEmailsCsv] = React.useState('');

  const naics = React.useMemo(
    () => value.naicsCsv.split(',').map((s) => s.trim()).filter(Boolean),
    [value.naicsCsv],
  );

  const ptype = React.useMemo(
    () => value.ptypeCsv.split(',').map((s) => s.trim()).filter(Boolean),
    [value.ptypeCsv],
  );

  const isoToMMDDYYYY = (iso: string): MmDdYyyy => {
    // iso = "2026-01-13"
    const [year, month, day] = iso.split('-');
    return `${month}/${day}/${year}`;
  }

  const buildCriteria = (offset = 0): LoadSamOpportunitiesRequest =>
    ({
      postedFrom: isoToMMDDYYYY(value.postedFrom),
      postedTo: isoToMMDDYYYY(value.postedTo),
      rdlfrom: isoToMMDDYYYY(value.rdlfrom),
      keywords: value.keywords.trim() || undefined,
      naics: naics.length ? naics : undefined,
      organizationName: value.agencyName.trim() || undefined,
      setAsideCode: value.setAsideCode.trim() || undefined,
      ptype: ptype.length ? ptype : undefined,
      limit: 25,
      offset,
    } as any);

  const doSearch = async () => {
    await onSearch(buildCriteria(0));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !isSearching) doSearch();
  };

  const applyQuickFilter = (days: number) => {
    const range = defaultDateRange(days, 0);
    onChange({ ...value, postedFrom: range.postedFrom, postedTo: range.postedTo });
  };

  const clearFilters = () => {
    const range = defaultDateRange(14, 0);
    onChange({
      keywords: '',
      naicsCsv: '541511',
      agencyName: '',
      setAsideCode: '',
      ptypeCsv: '',
      postedFrom: range.postedFrom,
      postedTo: range.postedTo,
      rdlfrom: range.rdlfrom,
    });
  };

  const handleSaveSearch = async () => {
    try {
      const notifyEmails = notifyEmailsCsv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const payload: CreateSavedSearchRequest = {
        orgId,
        name: saveName.trim() || 'My SAM Search',
        criteria: buildCriteria(0),
        frequency: saveFrequency,
        autoImport: saveAutoImport,
        notifyEmails,
        isEnabled: true,
      } as any;

      await createSavedSearch(payload);

      toast({
        title: 'Saved search created',
        description: `Saved: ${payload.name}`,
      });

      setSaveOpen(false);
    } catch (e) {
      toast({
        title: 'Failed to save search',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Search row */}
      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"/>
          <Input
            placeholder="Keywords (e.g., cloud migration, devsecops)…"
            value={value.keywords}
            onChange={(e) => onChange({ ...value, keywords: e.target.value })}
            onKeyDown={handleKeyDown}
            className="pl-10 h-11"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={doSearch} disabled={isSearching} className="h-11">
            {isSearching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
            ) : (
              <Search className="mr-2 h-4 w-4"/>
            )}
            Search
          </Button>

          <Button
            variant="outline"
            className="h-11"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Filter className="mr-2 h-4 w-4"/>
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-2">
                {activeFilterCount}
              </Badge>
            )}
            {showAdvanced ? (
              <ChevronUp className="ml-2 h-4 w-4"/>
            ) : (
              <ChevronDown className="ml-2 h-4 w-4"/>
            )}
          </Button>

          {/* Save search */}
          <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="h-11">
                <BookmarkPlus className="mr-2 h-4 w-4"/>
                Save
              </Button>
            </DialogTrigger>

            <DialogContent>
              <DialogHeader>
                <DialogTitle>Save search</DialogTitle>
                <DialogDescription>
                  Save this criteria and run it on a schedule (alerts later).
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="grid gap-2">
                  <Label>Name</Label>
                  <Input value={saveName} onChange={(e) => setSaveName(e.target.value)}/>
                </div>

                <div className="grid gap-2">
                  <Label>Frequency</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={saveFrequency}
                    onChange={(e) => setSaveFrequency(e.target.value as any)}
                  >
                    <option value="HOURLY">Hourly</option>
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label>Notify emails (comma-separated)</Label>
                  <Input
                    value={notifyEmailsCsv}
                    onChange={(e) => setNotifyEmailsCsv(e.target.value)}
                    placeholder="you@company.com, teammate@company.com"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={saveAutoImport}
                    onChange={(e) => setSaveAutoImport(e.target.checked)}
                  />
                  Auto-import new opportunities
                </label>

                <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                  This saves your current filters exactly (dates, NAICS, agency, etc.).
                </div>
              </div>

              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" disabled={isSavingSearch}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button onClick={handleSaveSearch} disabled={isSavingSearch}>
                  {isSavingSearch ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin"/>
                      Saving...
                    </>
                  ) : (
                    'Save search'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
            <Calendar className="mr-1 h-3.5 w-3.5"/>
            {f.label}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span>From</span>
          <span className="font-medium text-foreground">{value.postedFrom}</span>
          <span>to</span>
          <span className="font-medium text-foreground">{value.postedTo}</span>
        </div>
      </div>

      {/* Advanced */}
      {showAdvanced && (
        <div className="rounded-xl border bg-muted/30 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <FileText className="h-4 w-4"/>
                NAICS codes
              </Label>
              <Input
                value={value.naicsCsv}
                onChange={(e) => onChange({ ...value, naicsCsv: e.target.value })}
                placeholder="541511, 541512"
              />
              <p className="text-xs text-muted-foreground">Comma-separated</p>
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4"/>
                Agency name
              </Label>
              <Input
                value={value.agencyName}
                onChange={(e) => onChange({ ...value, agencyName: e.target.value })}
                placeholder="Department of Defense"
              />
            </div>

            <div className="space-y-2">
              <Label>Set-aside code</Label>
              <Input
                value={value.setAsideCode}
                onChange={(e) => onChange({ ...value, setAsideCode: e.target.value })}
                placeholder="8A, SDVOSB, HUBZone…"
              />
            </div>

            <div className="space-y-2">
              <Label>Procurement type (ptype)</Label>
              <Input
                value={value.ptypeCsv}
                onChange={(e) => onChange({ ...value, ptypeCsv: e.target.value })}
                placeholder="Comma-separated"
              />
            </div>

            <div className="space-y-2">
              <Label>Posted from</Label>
              <Input
                type="date"
                className='block'
                value={value.postedFrom}
                onChange={(e) => onChange({ ...value, postedFrom: e.target.value })}
                placeholder="MM/DD/YYYY"
              />
            </div>

            <div className="space-y-2">
              <Label>Posted to</Label>
              <Input
                type="date"
                className='block'
                value={value.postedTo}
                onChange={(e) => onChange({ ...value, postedTo: e.target.value })}
                placeholder="MM/DD/YYYY"
              />
            </div>

            <div className="space-y-2">
              <Label>Due date from</Label>
              <Input
                type="date"
                className='block'
                value={value.rdlfrom}
                onChange={(e) => onChange({ ...value, rdlfrom: e.target.value })}
                placeholder="MM/DD/YYYY"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={clearFilters} className="w-full sm:w-auto">
              <X className="mr-2 h-4 w-4"/>
              Reset filters
            </Button>
            <div className="sm:ml-auto text-xs text-muted-foreground self-center">
              Tip: keep NAICS narrow for better results.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}