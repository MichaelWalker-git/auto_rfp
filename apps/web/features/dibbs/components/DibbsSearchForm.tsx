'use client';

import * as React from 'react';
import { format, subDays } from 'date-fns';
import {
  Building2,
  CalendarIcon,
  ChevronDown,
  ChevronUp,
  Filter,
  Loader2,
  Search,
  Shield,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { SearchDibbsOpportunitiesRequest } from '@auto-rfp/core';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const toMMDDYYYY = (d: Date): string =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

const defaultRange = (daysBack: number) => ({
  postedFrom: subDays(new Date(), daysBack),
  postedTo: new Date(),
});

// ─── Quick filter presets ─────────────────────────────────────────────────────

const QUICK_FILTERS = [
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

// ─── DoD component options ────────────────────────────────────────────────────

const DOD_COMPONENTS = [
  { value: 'Army',   label: 'Army' },
  { value: 'Navy',   label: 'Navy' },
  { value: 'Air Force', label: 'Air Force' },
  { value: 'Marine Corps', label: 'Marine Corps' },
  { value: 'Space Force', label: 'Space Force' },
  { value: 'DARPA',  label: 'DARPA' },
  { value: 'DLA',    label: 'DLA' },
  { value: 'SOCOM',  label: 'SOCOM' },
  { value: 'OSD',    label: 'OSD' },
];

// ─── Contract vehicle options ─────────────────────────────────────────────────

const CONTRACT_VEHICLES = [
  { value: 'SBIR',  label: 'SBIR' },
  { value: 'STTR',  label: 'STTR' },
  { value: 'OTA',   label: 'OTA (Other Transaction Authority)' },
  { value: 'IDIQ',  label: 'IDIQ' },
  { value: 'BPA',   label: 'BPA' },
  { value: 'GWAC',  label: 'GWAC' },
];

// ─── Technology area options ──────────────────────────────────────────────────

const TECH_AREAS = [
  { value: 'AI/ML',          label: 'AI / Machine Learning' },
  { value: 'Cybersecurity',  label: 'Cybersecurity' },
  { value: 'C2',             label: 'Command & Control (C2)' },
  { value: 'ISR',            label: 'ISR' },
  { value: 'Autonomous',     label: 'Autonomous Systems' },
  { value: 'Space',          label: 'Space' },
  { value: 'Biotech',        label: 'Biotech / Medical' },
  { value: 'Energy',         label: 'Energy / Power' },
  { value: 'Logistics',      label: 'Logistics' },
  { value: 'Training',       label: 'Training & Simulation' },
];

// ─── DatePickerButton ─────────────────────────────────────────────────────────

function DatePickerButton({
  value,
  onChange,
  placeholder,
  disabledFn,
}: {
  value: Date | undefined;
  onChange: (d: Date | undefined) => void;
  placeholder: string;
  disabledFn?: (d: Date) => boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            'w-full justify-start text-left font-normal h-10',
            !value && 'text-muted-foreground',
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
          {value ? format(value, 'MMM d, yyyy') : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={onChange}
          disabled={disabledFn}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface DibbsSearchFormProps {
  onSearch: (criteria: SearchDibbsOpportunitiesRequest) => void;
  isLoading: boolean;
}

export const DibbsSearchForm = ({ onSearch, isLoading }: DibbsSearchFormProps) => {
  const initial = React.useMemo(() => defaultRange(30), []);

  const [keywords,        setKeywords]        = React.useState('');
  const [solNum,          setSolNum]          = React.useState('');
  const [dodComponent,    setDodComponent]    = React.useState('');
  const [contractVehicle, setContractVehicle] = React.useState('');
  const [techArea,        setTechArea]        = React.useState('');
  const [setAsideCode,    setSetAsideCode]    = React.useState('');
  const [naicsCsv,        setNaicsCsv]        = React.useState('');
  const [postedFrom,      setPostedFrom]      = React.useState<Date | undefined>(initial.postedFrom);
  const [postedTo,        setPostedTo]        = React.useState<Date | undefined>(initial.postedTo);
  const [closingFrom,     setClosingFrom]     = React.useState<Date | undefined>();
  const [closingTo,       setClosingTo]       = React.useState<Date | undefined>();
  const [showAdvanced,    setShowAdvanced]    = React.useState(false);

  const activeFilterCount = React.useMemo(() => [
    keywords.trim(),
    solNum.trim(),
    dodComponent && dodComponent !== 'all' ? dodComponent : '',
    contractVehicle && contractVehicle !== 'all' ? contractVehicle : '',
    techArea && techArea !== 'all' ? techArea : '',
    setAsideCode.trim(),
    naicsCsv.trim(),
    closingFrom ? 'closingFrom' : '',
    closingTo   ? 'closingTo'   : '',
  ].filter(Boolean).length, [keywords, solNum, dodComponent, contractVehicle, techArea, setAsideCode, naicsCsv, closingFrom, closingTo]);

  const buildRequest = (): SearchDibbsOpportunitiesRequest => ({
    keywords:           keywords.trim()  || undefined,
    solicitationNumber: solNum.trim()    || undefined,
    dodComponents:      dodComponent && dodComponent !== 'all'    ? [dodComponent]    : undefined,
    contractVehicles:   contractVehicle && contractVehicle !== 'all' ? [contractVehicle] : undefined,
    technologyAreas:    techArea && techArea !== 'all'            ? [techArea]        : undefined,
    setAsideCode:       setAsideCode.trim() || undefined,
    naics:              naicsCsv.trim()
      ? naicsCsv.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
    postedFrom:  postedFrom  ? toMMDDYYYY(postedFrom)  : undefined,
    postedTo:    postedTo    ? toMMDDYYYY(postedTo)    : undefined,
    closingFrom: closingFrom ? toMMDDYYYY(closingFrom) : undefined,
    closingTo:   closingTo   ? toMMDDYYYY(closingTo)   : undefined,
    limit: 25,
    offset: 0,
  });

  const doSearch = () => onSearch(buildRequest());

  const applyQuickFilter = (days: number) => {
    const range = defaultRange(days);
    setPostedFrom(range.postedFrom);
    setPostedTo(range.postedTo);
  };

  const clearFilters = () => {
    setKeywords('');
    setSolNum('');
    setDodComponent('');
    setContractVehicle('');
    setTechArea('');
    setSetAsideCode('');
    setNaicsCsv('');
    setPostedFrom(initial.postedFrom);
    setPostedTo(initial.postedTo);
    setClosingFrom(undefined);
    setClosingTo(undefined);
  };

  return (
    <div className="space-y-4">
      {/* ── Search row ── */}
      <div className="flex flex-col gap-2 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Keywords (e.g. autonomous systems, cybersecurity, AI/ML)…"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && doSearch()}
            className="pl-10 h-11"
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={doSearch} disabled={isLoading} className="h-11">
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Shield className="mr-2 h-4 w-4" />
            )}
            Search DIBBS
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
            {showAdvanced ? (
              <ChevronUp className="ml-2 h-4 w-4" />
            ) : (
              <ChevronDown className="ml-2 h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* ── Quick date filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Posted:</span>
        {QUICK_FILTERS.map((f) => (
          <Button
            key={f.days}
            variant="outline"
            size="sm"
            onClick={() => applyQuickFilter(f.days)}
            className="h-8"
          >
            <CalendarIcon className="mr-1 h-3.5 w-3.5" />
            {f.label}
          </Button>
        ))}
        {(postedFrom || postedTo) && (
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <span>From</span>
            <span className="font-medium text-foreground">
              {postedFrom ? format(postedFrom, 'MMM d, yyyy') : '—'}
            </span>
            <span>to</span>
            <span className="font-medium text-foreground">
              {postedTo ? format(postedTo, 'MMM d, yyyy') : '—'}
            </span>
          </div>
        )}
      </div>

      {/* ── Advanced filters ── */}
      {showAdvanced && (
        <div className="rounded-xl border bg-muted/30 p-4 space-y-4">
          {/* Row 1: DoD Component, Contract Vehicle, Tech Area */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                DoD Component
              </Label>
              <Select value={dodComponent} onValueChange={setDodComponent}>
                <SelectTrigger>
                  <SelectValue placeholder="Any component" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any component</SelectItem>
                  {DOD_COMPONENTS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Contract Vehicle</Label>
              <Select value={contractVehicle} onValueChange={setContractVehicle}>
                <SelectTrigger>
                  <SelectValue placeholder="Any vehicle" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any vehicle</SelectItem>
                  {CONTRACT_VEHICLES.map((v) => (
                    <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Technology Area</Label>
              <Select value={techArea} onValueChange={setTechArea}>
                <SelectTrigger>
                  <SelectValue placeholder="Any area" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any area</SelectItem>
                  {TECH_AREAS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Row 2: Solicitation #, Set-aside, NAICS */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label>Solicitation Number</Label>
              <Input
                value={solNum}
                onChange={(e) => setSolNum(e.target.value)}
                placeholder="e.g. W911NF-25-BAA-001"
              />
            </div>

            <div className="space-y-2">
              <Label>Set-aside Code</Label>
              <Input
                value={setAsideCode}
                onChange={(e) => setSetAsideCode(e.target.value)}
                placeholder="8A, SDVOSB, HUBZone…"
              />
            </div>

            <div className="space-y-2">
              <Label>NAICS Codes</Label>
              <Input
                value={naicsCsv}
                onChange={(e) => setNaicsCsv(e.target.value)}
                placeholder="541511, 541512 (comma-separated)"
              />
            </div>
          </div>

          {/* Row 3: Date pickers */}
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label>Posted From</Label>
              <DatePickerButton
                value={postedFrom}
                onChange={setPostedFrom}
                placeholder="Pick a date"
                disabledFn={(d) => (postedTo ? d > postedTo : false)}
              />
            </div>

            <div className="space-y-2">
              <Label>Posted To</Label>
              <DatePickerButton
                value={postedTo}
                onChange={setPostedTo}
                placeholder="Pick a date"
                disabledFn={(d) => (postedFrom ? d < postedFrom : false)}
              />
            </div>

            <div className="space-y-2">
              <Label>Closing From</Label>
              <DatePickerButton
                value={closingFrom}
                onChange={setClosingFrom}
                placeholder="Pick a date"
                disabledFn={(d) => (closingTo ? d > closingTo : false)}
              />
            </div>

            <div className="space-y-2">
              <Label>Closing To</Label>
              <DatePickerButton
                value={closingTo}
                onChange={setClosingTo}
                placeholder="Pick a date"
                disabledFn={(d) => (closingFrom ? d < closingFrom : false)}
              />
            </div>
          </div>

          {/* Reset row */}
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <X className="mr-2 h-4 w-4" />
              Reset filters
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              All filters are optional — search works with no input.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
