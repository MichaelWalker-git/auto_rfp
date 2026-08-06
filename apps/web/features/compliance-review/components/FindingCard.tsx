'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, Undo2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ComplianceFindingSeverity } from '@auto-rfp/core';
import { buildFindingHref } from '../lib/navigateToFinding';
import type { DecoratedFinding } from '../hooks/useFindingDecisions';

const SEVERITY_STYLES: Record<ComplianceFindingSeverity, string> = {
  critical: 'bg-red-100 text-red-800 border-red-200',
  major: 'bg-orange-100 text-orange-800 border-orange-200',
  minor: 'bg-amber-100 text-amber-800 border-amber-200',
  info: 'bg-slate-100 text-slate-700 border-slate-200',
};

interface FindingCardProps {
  finding: DecoratedFinding;
  orgId: string;
  projectId: string;
  oppId: string;
  onDismiss?: (fingerprint: string) => void;
  onResolve?: (fingerprint: string) => void;
  onReopen?: (fingerprint: string) => void;
  /** Global expand/minimize default. */
  defaultExpanded?: boolean;
  /** Bumped when the global toggle is clicked, to re-sync this card to defaultExpanded. */
  expandSignal?: number;
  /**
   * Display-only mode (chat): keep "Go to spot" navigation but hide
   * Resolve/Dismiss/Reopen. The full-review tab is the single triage surface,
   * so chat-surfaced findings are not independently actionable.
   */
  readOnly?: boolean;
}

export const FindingCard = ({
  finding,
  orgId,
  projectId,
  oppId,
  onDismiss,
  onResolve,
  onReopen,
  defaultExpanded = true,
  expandSignal = 0,
  readOnly = false,
}: FindingCardProps) => {
  const href = buildFindingHref(orgId, projectId, oppId, finding);
  const isDecided = finding.decisionState === 'dismissed' || finding.decisionState === 'resolved';

  const [expanded, setExpanded] = useState(defaultExpanded);
  // Re-sync to the global default whenever the global toggle fires; individual
  // clicks in between still let a single card diverge until the next global toggle.
  useEffect(() => setExpanded(defaultExpanded), [expandSignal, defaultExpanded]);

  const hasDetails = !!(finding.description || finding.snippet || finding.suggestion);

  return (
    <Card className={cn('p-4 gap-3', isDecided && 'opacity-60')}>
      {/* Line 1–2: labels + doc name, and the issue title. Clickable to toggle. */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-start justify-between gap-3 text-left"
        aria-expanded={expanded}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={SEVERITY_STYLES[finding.severity]}>
              {finding.severity}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {finding.issueType.replace(/_/g, ' ').toLowerCase()}
            </Badge>
            {finding.documentTitle && (
              <span className="text-xs text-muted-foreground">{finding.documentTitle}</span>
            )}
          </div>
          <p className="font-medium text-sm">{finding.title}</p>
        </div>
        {hasDetails && (
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 mt-1 text-muted-foreground transition-transform', expanded && 'rotate-180')}
          />
        )}
      </button>

      {/* Details: shown only when expanded. */}
      {expanded && (
        <>
          {finding.description && <p className="text-sm text-muted-foreground">{finding.description}</p>}

          {finding.snippet && (
            <blockquote className="border-l-2 border-slate-300 pl-3 text-xs italic text-slate-600">
              &ldquo;{finding.snippet}&rdquo;
            </blockquote>
          )}

          {finding.suggestion && (
            <p className="text-sm">
              <span className="font-medium">Suggestion: </span>
              {finding.suggestion}
            </p>
          )}
        </>
      )}

      {/* Last line: navigate + decision actions. Always visible. */}
      <div className="flex items-center justify-between gap-2 pt-1">
        <div>
          {href ? (
            <Button asChild variant="secondary" size="sm">
              <Link href={href}>
                {finding.anchorValid ? 'Go to spot' : 'Open document'}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {finding.targetKind === 'FORM_MISSING' ? 'Missing form — no document to open' : ''}
            </span>
          )}
        </div>

        {!readOnly && (
          <div className="flex items-center gap-2">
            {isDecided ? (
              <Button variant="outline" size="sm" onClick={() => onReopen?.(finding.fingerprint)}>
                <Undo2 className="mr-1 h-3.5 w-3.5" />
                Reopen
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950"
                  onClick={() => onResolve?.(finding.fingerprint)}
                >
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Resolve
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  onClick={() => onDismiss?.(finding.fingerprint)}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Dismiss
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
