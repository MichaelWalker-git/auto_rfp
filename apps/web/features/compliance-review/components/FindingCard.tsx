'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, ChevronDown, Sparkles, Undo2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
// Cross-feature seam: import ONLY through the package-edit barrel (a small hook +
// the inline run view), never its internal paths — keeps the coupling explicit.
import { InlineFindingEditor } from '@/features/package-edit';
import { buildFindingHref } from '../lib/navigateToFinding';
import { SEVERITY_STYLES } from './FindingsStats';
import type { DecoratedFinding } from '../hooks/useFindingDecisions';

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
  // `editorOpened` latches true on first "Edit with AI" so the editor MOUNTS once
  // and keeps its state (seeded instruction + any in-flight proposal run).
  // `editorVisible` is the show/hide toggle — collapsing hides it via CSS instead
  // of unmounting, so toggling the button never discards proposals (the bug where
  // a second/third click wiped the proposal list).
  const [editorOpened, setEditorOpened] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);

  const handleToggleEditor = () => {
    setEditorOpened(true);
    setEditorVisible((v) => !v);
  };
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
            <blockquote className="rounded-r-md border-l-2 border-border bg-muted/50 py-1.5 pl-3 pr-2 text-xs italic text-foreground/80">
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
            <Button
              variant="outline"
              size="sm"
              className="border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800 dark:border-indigo-900 dark:text-indigo-400 dark:hover:bg-indigo-950"
              onClick={handleToggleEditor}
              aria-expanded={editorVisible}
            >
              <Sparkles className="mr-1 h-3.5 w-3.5" />
              {editorVisible ? 'Hide AI editor' : 'Edit with AI'}
            </Button>
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

      {/* Inline "Edit with AI": seeds an instruction from this finding and runs the
          propose→apply flow in-card. Never shown in read-only (chat) findings.
          Once opened it stays MOUNTED (only hidden via CSS when collapsed) so
          toggling the button never discards an in-flight proposal run. */}
      {!readOnly && editorOpened && (
        <div className={cn(!editorVisible && 'hidden')}>
          <InlineFindingEditor
            finding={finding}
            orgId={orgId}
            projectId={projectId}
            oppId={oppId}
            onResolve={onResolve}
          />
        </div>
      )}
    </Card>
  );
};
