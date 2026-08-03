'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import type { ComplianceFinding, ComplianceIssueType, ComplianceFindingSeverity } from '@auto-rfp/core';

interface FindingsStatsProps {
  findings: ComplianceFinding[];
}

// Human-readable, pluralized labels for the issue-type breakdown.
const ISSUE_LABELS: Record<ComplianceIssueType, string> = {
  MISSING_REQUIREMENT: 'missing requirements',
  MISSING_FORM: 'missing forms',
  INCORRECT_ANSWER: 'incorrect answers',
  POOR_ANSWER: 'poor answers',
  FORMAT_ISSUE: 'format issues',
  INCONSISTENCY: 'inconsistencies',
  OTHER: 'other',
};

// Stable display order + colours for the severity summary (critical first).
const SEVERITY_ORDER: ComplianceFindingSeverity[] = ['critical', 'major', 'minor', 'info'];
const SEVERITY_STYLES: Record<ComplianceFindingSeverity, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  major: 'bg-orange-100 text-orange-800 border-orange-200',
  minor: 'bg-amber-100 text-amber-800 border-amber-200',
  info: 'bg-slate-100 text-slate-700 border-slate-200',
};

/**
 * Compact statistics shown in place of the finding cards when the review section
 * is collapsed: a total count, a severity breakdown, and an issue-type breakdown
 * (e.g. "22 findings — 3 missing forms, 2 incorrect answers, …").
 */
export const FindingsStats = ({ findings }: FindingsStatsProps) => {
  const { total, bySeverity, byIssue } = useMemo(() => {
    const sev = {} as Record<ComplianceFindingSeverity, number>;
    const issue = {} as Record<ComplianceIssueType, number>;
    for (const f of findings) {
      sev[f.severity] = (sev[f.severity] ?? 0) + 1;
      issue[f.issueType] = (issue[f.issueType] ?? 0) + 1;
    }
    return { total: findings.length, bySeverity: sev, byIssue: issue };
  }, [findings]);

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">No active findings.</p>
    );
  }

  const issueParts = (Object.keys(byIssue) as ComplianceIssueType[])
    .sort((a, b) => byIssue[b] - byIssue[a])
    .map((k) => `${byIssue[k]} ${ISSUE_LABELS[k]}`);

  return (
    <div className="space-y-3 py-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold">
          {total} {total === 1 ? 'finding' : 'findings'}
        </span>
        {SEVERITY_ORDER.filter((s) => bySeverity[s]).map((s) => (
          <Badge key={s} variant="outline" className={SEVERITY_STYLES[s]}>
            {bySeverity[s]} {s}
          </Badge>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{issueParts.join(', ')}</p>
    </div>
  );
};
