'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FindingCard } from './FindingCard';
import type { ComplianceFindingSeverity } from '@auto-rfp/core';
import type { DecoratedFinding } from '../hooks/useFindingDecisions';

// Critical first, info last.
const SEVERITY_ORDER: Record<ComplianceFindingSeverity, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  info: 3,
};

const bySeverity = (a: DecoratedFinding, b: DecoratedFinding): number =>
  SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];

interface FindingsListProps {
  activeFindings: DecoratedFinding[];
  dismissedFindings?: DecoratedFinding[];
  resolvedFindings?: DecoratedFinding[];
  orgId: string;
  projectId: string;
  oppId: string;
  onDismiss?: (fingerprint: string) => void;
  onResolve?: (fingerprint: string) => void;
  onReopen?: (fingerprint: string) => void;
  /** Global expand/minimize default for every card. */
  defaultExpanded?: boolean;
  /** Bumped by the global toggle to re-sync all cards. */
  expandSignal?: number;
  /** When true, an empty list means "filters matched nothing" rather than "no issues". */
  filtered?: boolean;
  /** Display-only: cards keep "Go to spot" but hide Resolve/Dismiss (chat). */
  readOnly?: boolean;
}

interface CardListProps {
  findings: DecoratedFinding[];
  orgId: string;
  projectId: string;
  oppId: string;
  onDismiss?: (fingerprint: string) => void;
  onResolve?: (fingerprint: string) => void;
  onReopen?: (fingerprint: string) => void;
  defaultExpanded: boolean;
  expandSignal: number;
  readOnly?: boolean;
}

const CardList = ({ findings, ...rest }: CardListProps) => (
  <>
    {[...findings].sort(bySeverity).map((f, i) => (
      // fingerprint is a dedup identity, not a uniqueness guarantee — two
      // findings can collapse to the same one, so pair it with the index.
      // `data-fp` lets the list restore scroll position around a resolve/dismiss.
      <div key={`${f.fingerprint}-${i}`} data-fp={f.fingerprint}>
        <FindingCard finding={f} {...rest} />
      </div>
    ))}
  </>
);

interface DecidedGroupProps extends CardListProps {
  label: string;
}

const DecidedGroup = ({ label, findings, ...rest }: DecidedGroupProps) => {
  const [open, setOpen] = useState(false);
  if (findings.length === 0) return null;
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        {label} ({findings.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        <CardList findings={findings} {...rest} />
      </CollapsibleContent>
    </Collapsible>
  );
};

export const FindingsList = ({
  activeFindings,
  dismissedFindings = [],
  resolvedFindings = [],
  orgId,
  projectId,
  oppId,
  onDismiss,
  onResolve,
  onReopen,
  defaultExpanded = true,
  expandSignal = 0,
  filtered = false,
  readOnly = false,
}: FindingsListProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  // When a finding is decided it leaves the active list (often collapsing a very
  // tall card — inline editor + a long proposal list — into the "Resolved" group),
  // so everything below jumps up by thousands of px while scrollTop stays fixed.
  // To keep the view steady we remember an anchor element (the next active finding,
  // or the decided one's neighbour) and its viewport offset at click time, then
  // after re-render scroll by the delta so that anchor stays put.
  const anchor = useRef<{ fingerprint: string; top: number } | null>(null);

  const activeOrder = useMemo(
    () => [...activeFindings].sort(bySeverity).map((f) => f.fingerprint),
    [activeFindings],
  );

  const rememberAnchor = (decidedFingerprint: string) => {
    const root = containerRef.current;
    if (!root) return;
    // Pick the next active finding after the decided one (falling back to the
    // previous) — it's the element that should visually stay in place.
    const idx = activeOrder.indexOf(decidedFingerprint);
    const candidates = [
      ...activeOrder.slice(idx + 1),
      ...activeOrder.slice(0, idx).reverse(),
    ].filter((fp) => fp !== decidedFingerprint);
    for (const fp of candidates) {
      const el = root.querySelector<HTMLElement>(`[data-fp="${CSS.escape(fp)}"]`);
      if (el) {
        anchor.current = { fingerprint: fp, top: el.getBoundingClientRect().top };
        return;
      }
    }
    anchor.current = null;
  };

  // After the list re-renders post-decision, restore the anchor's viewport offset.
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-fp="${CSS.escape(a.fingerprint)}"]`,
    );
    if (!el) return;
    const delta = el.getBoundingClientRect().top - a.top;
    if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
  }, [activeOrder]);

  const handleResolve = onResolve
    ? (fp: string) => {
        rememberAnchor(fp);
        onResolve(fp);
      }
    : undefined;
  const handleDismiss = onDismiss
    ? (fp: string) => {
        rememberAnchor(fp);
        onDismiss(fp);
      }
    : undefined;

  const shared = {
    orgId,
    projectId,
    oppId,
    onDismiss: handleDismiss,
    onResolve: handleResolve,
    onReopen,
    defaultExpanded,
    expandSignal,
    readOnly,
  };

  if (
    activeFindings.length === 0 &&
    dismissedFindings.length === 0 &&
    resolvedFindings.length === 0
  ) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {filtered
          ? 'No findings match the current filters.'
          : 'No compliance issues found in this review.'}
      </p>
    );
  }

  return (
    <div className="space-y-3" ref={containerRef}>
      <CardList findings={activeFindings} {...shared} />
      <DecidedGroup label="Resolved" findings={resolvedFindings} {...shared} />
      <DecidedGroup label="Dismissed" findings={dismissedFindings} {...shared} />
    </div>
  );
};
