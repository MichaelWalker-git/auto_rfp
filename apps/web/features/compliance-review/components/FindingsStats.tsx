'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ComplianceFinding, ComplianceIssueType, ComplianceFindingSeverity } from '@auto-rfp/core';

interface FindingsStatsProps {
  findings: ComplianceFinding[];
  /**
   * When provided, the severity badges become toggle filters: clicking a badge
   * selects that severity (clicking the active one clears it). `activeSeverity`
   * is the currently-filtered severity (null = no severity filter). Omit both to
   * render the badges as static labels (e.g. the collapsed/read-only summary).
   */
  activeSeverity?: ComplianceFindingSeverity | null;
  onToggleSeverity?: (severity: ComplianceFindingSeverity) => void;
}

// Human-readable, pluralized labels for the issue-type breakdown.
const ISSUE_LABELS: Record<ComplianceIssueType, string> = {
  MISSING_REQUIREMENT: 'missing requirements',
  MISSING_FORM: 'missing forms',
  INCORRECT_ANSWER: 'incorrect answers',
  POOR_ANSWER: 'poor answers',
  FORMAT_ISSUE: 'format issues',
  INCONSISTENCY: 'inconsistencies',
  FACTUAL_INACCURACY: 'factual inaccuracies',
  UNVERIFIED_CLAIM: 'unverified claims',
  NDA_DISCLOSURE_LEAK: 'NDA disclosure leaks',
  SOLUTION_PLAN_MISMATCH: 'solution-plan mismatches',
  OTHER: 'other',
};

// Stable display order + colours for the severity summary (critical first).
// A red→orange→yellow→slate "heat" gradient so severity is readable at a glance.
// Dark mode uses transparent color TINTS with saturated text (not solid `-950`
// fills, which collapse to near-black and become indistinguishable); `minor` is
// yellow (not amber) so it separates clearly from `major` orange.
export const SEVERITY_ORDER: ComplianceFindingSeverity[] = ['critical', 'major', 'minor', 'info'];
export const SEVERITY_STYLES: Record<ComplianceFindingSeverity, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30',
  major: 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30',
  minor: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-200 dark:border-yellow-500/30',
  info: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/15 dark:text-slate-300 dark:border-slate-400/25',
};

/**
 * The focal summary of a review: a hero total, a severity breakdown, and an
 * issue-type breakdown (e.g. "22 findings — 3 missing forms, 2 incorrect
 * answers, …"). Rendered as a persistent banner above the finding cards so the
 * "how bad is it?" answer is always visible, and shown alone when the list is
 * collapsed.
 */
export const FindingsStats = ({ findings, activeSeverity, onToggleSeverity }: FindingsStatsProps) => {
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
      <div className="rounded-lg border bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">No active findings — everything here is resolved or dismissed.</p>
      </div>
    );
  }

  const issueParts = (Object.keys(byIssue) as ComplianceIssueType[])
    .sort((a, b) => byIssue[b] - byIssue[a])
    .map((k) => `${byIssue[k]} ${ISSUE_LABELS[k]}`);

  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        {/* Hero total — the focal element AND the "show all" control: with a
            severity filter active it dims and a click clears the filter. */}
        {(() => {
          const hero = (
            <>
              <span className="text-2xl font-semibold tabular-nums leading-none">{total}</span>
              <span className="text-sm text-muted-foreground">{total === 1 ? 'finding' : 'findings'}</span>
            </>
          );
          if (!onToggleSeverity) return <div className="flex items-baseline gap-1.5">{hero}</div>;
          const showingAll = !activeSeverity;
          return (
            <Button
              type="button"
              variant="ghost"
              onClick={() => activeSeverity && onToggleSeverity(activeSeverity)}
              aria-pressed={showingAll}
              disabled={showingAll}
              title={showingAll ? 'Showing all findings' : 'Show all findings'}
              // Override the ghost defaults (fixed height, padding, hover fill,
              // disabled dimming) so this reads as the inline baseline-aligned hero
              // toggle it was — dimming here is driven by the active-filter state.
              className={cn(
                'flex h-auto items-baseline gap-1.5 rounded-md p-0 transition-opacity hover:bg-transparent disabled:opacity-100',
                showingAll ? 'cursor-default' : 'cursor-pointer opacity-40 hover:opacity-80',
              )}
            >
              {hero}
            </Button>
          );
        })()}
        <div className="flex flex-wrap items-center gap-1.5">
          {SEVERITY_ORDER.filter((s) => bySeverity[s]).map((s) => {
            const badge = (
              <Badge
                variant="outline"
                className={cn(
                  'capitalize tabular-nums leading-none',
                  SEVERITY_STYLES[s],
                  // A filter is active elsewhere but not on this severity → dim it
                  // so the selected one reads as chosen.
                  onToggleSeverity && activeSeverity && activeSeverity !== s && 'opacity-40',
                )}
              >
                {bySeverity[s]} {s}
              </Badge>
            );
            if (!onToggleSeverity) return <span key={s}>{badge}</span>;
            return (
              <Button
                key={s}
                type="button"
                variant="ghost"
                onClick={() => onToggleSeverity(s)}
                aria-pressed={activeSeverity === s}
                title={activeSeverity === s ? `Clear ${s} filter` : `Filter to ${s}`}
                // Override the ghost defaults so the badge (which carries its own
                // severity color) is the only visible surface — no height, padding,
                // or hover fill from the button itself.
                className="h-auto cursor-pointer rounded-md p-0 transition-opacity hover:bg-transparent hover:opacity-80"
              >
                {badge}
              </Button>
            );
          })}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{issueParts.join(' · ')}</p>
    </div>
  );
};
