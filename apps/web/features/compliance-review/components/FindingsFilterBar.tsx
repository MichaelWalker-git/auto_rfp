'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ComplianceFinding, ComplianceIssueType, ComplianceFindingSeverity } from '@auto-rfp/core';
import { SEVERITY_ORDER } from './FindingsStats';

/** Sentinel for "no filter" — Radix Select disallows empty-string values. */
export const ALL = '__all__';

/** Stable key for the document dimension: real documentId, or a bucket for missing forms. */
export const MISSING_FORMS_KEY = '__missing_forms__';

const documentKey = (f: ComplianceFinding): string =>
  f.documentId ?? (f.targetKind === 'FORM_MISSING' ? MISSING_FORMS_KEY : 'unknown');

const documentLabel = (f: ComplianceFinding): string =>
  f.documentTitle ?? (f.targetKind === 'FORM_MISSING' ? 'Missing forms' : 'Unknown');

const prettyIssueType = (t: ComplianceIssueType): string => t.replace(/_/g, ' ').toLowerCase();

export interface FindingsFilter {
  issueType: ComplianceIssueType | typeof ALL;
  documentKey: string;
  severity: ComplianceFindingSeverity | typeof ALL;
}

export const emptyFilter: FindingsFilter = { issueType: ALL, documentKey: ALL, severity: ALL };

export const isFilterActive = (f: FindingsFilter): boolean =>
  f.issueType !== ALL || f.documentKey !== ALL || f.severity !== ALL;

/** Apply a filter to a finding list (pure). Generic so it preserves DecoratedFinding. */
export const applyFilter = <T extends ComplianceFinding>(findings: T[], filter: FindingsFilter): T[] =>
  findings.filter(
    (f) =>
      (filter.issueType === ALL || f.issueType === filter.issueType) &&
      (filter.documentKey === ALL || documentKey(f) === filter.documentKey) &&
      (filter.severity === ALL || f.severity === filter.severity),
  );

interface FindingsFilterBarProps {
  /** All findings (active + decided) — used to derive the available options. */
  allFindings: ComplianceFinding[];
  filter: FindingsFilter;
  onChange: (filter: FindingsFilter) => void;
}

export const FindingsFilterBar = ({ allFindings, filter, onChange }: FindingsFilterBarProps) => {
  const issueTypes = useMemo(
    () => Array.from(new Set(allFindings.map((f) => f.issueType))).sort(),
    [allFindings],
  );

  const documents = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of allFindings) map.set(documentKey(f), documentLabel(f));
    return Array.from(map, ([key, label]) => ({ key, label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [allFindings]);

  // Severities present, in canonical order (critical → info).
  const severities = useMemo(() => {
    const present = new Set(allFindings.map((f) => f.severity));
    return SEVERITY_ORDER.filter((s) => present.has(s));
  }, [allFindings]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={filter.severity}
        onValueChange={(v) => onChange({ ...filter, severity: v as FindingsFilter['severity'] })}
      >
        <SelectTrigger className="h-8 w-[150px] text-xs capitalize">
          <SelectValue placeholder="All severities" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All severities</SelectItem>
          {severities.map((s) => (
            <SelectItem key={s} value={s} className="capitalize">
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filter.issueType}
        onValueChange={(v) => onChange({ ...filter, issueType: v as FindingsFilter['issueType'] })}
      >
        <SelectTrigger className="h-8 w-[180px] text-xs">
          <SelectValue placeholder="All issue types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All issue types</SelectItem>
          {issueTypes.map((t) => (
            <SelectItem key={t} value={t}>
              {prettyIssueType(t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filter.documentKey}
        onValueChange={(v) => onChange({ ...filter, documentKey: v })}
      >
        <SelectTrigger className="h-8 w-[220px] text-xs">
          <SelectValue placeholder="All documents" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All documents</SelectItem>
          {documents.map((d) => (
            <SelectItem key={d.key} value={d.key}>
              {d.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {isFilterActive(filter) && (
        <Button variant="ghost" size="sm" onClick={() => onChange(emptyFilter)}>
          <X className="mr-1 h-3.5 w-3.5" />
          Clear filters
        </Button>
      )}
    </div>
  );
};
