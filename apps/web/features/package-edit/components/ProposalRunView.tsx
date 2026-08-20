'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { usePackageEditRun } from '../hooks/usePackageEditRun';
import { useApplyEdits } from '../hooks/useApplyEdits';
import { ProposalDiffCard } from './ProposalDiffCard';
import { ApplyResultReport } from './ApplyResultReport';

interface ProposalRunViewProps {
  orgId: string;
  projectId: string;
  oppId: string;
  /**
   * Poll a SPECIFIC run instead of the opportunity's latest. The unified chat
   * passes the message's editRunId so an inline run view can't show a run started
   * from another surface that happens to be latest (W2). Omit to track latest.
   */
  runId?: string;
  /** Called after edits are applied so the parent can refresh doc/form views. */
  onApplied?: () => void;
  /**
   * When provided (inline finding-card editor), renders a second
   * "Apply & resolve finding" action. It resolves the originating finding only
   * if at least one edit actually applied — resolving a finding whose fix all
   * skipped-stale would be misleading. Called after the apply completes.
   */
  onResolveFinding?: () => void | Promise<void>;
  /**
   * When provided, renders a "Discard" action on the proposal list so a user who
   * doesn't like the proposals can throw them away and reword the request. The
   * parent owns what "discard" means (e.g. drop back to the composer).
   */
  onDiscard?: () => void;
}

/**
 * Polls the latest proposal run and drives the review→apply flow:
 * skeleton while PROPOSING, then the selectable proposal list, then the apply
 * report. Reused by the unified compliance-review chat and the inline
 * finding-card editor (both pass a specific runId).
 */
export const ProposalRunView = ({
  orgId,
  projectId,
  oppId,
  runId,
  onApplied,
  onResolveFinding,
  onDiscard,
}: ProposalRunViewProps) => {
  const { run, proposals, status, stale, isProposing, isLoading, refresh } = usePackageEditRun(
    orgId,
    projectId,
    oppId,
    runId,
  );
  const { applyEdits, isApplying, results, resetResults } = useApplyEdits(orgId, projectId, oppId);

  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // The runId whose proposals we've already auto-selected. Using this (not
  // "selected is empty") as the init signal is the fix for W1: an empty selection
  // ALSO means "user hit Deselect all", and SWR revalidation (reconnect/focus/
  // poll) re-runs the default-select effect — which would wipe the user's
  // deselect. Keying init on runId makes the default fire exactly once per run.
  const initializedRunId = useRef<string | null>(null);

  // When the run changes (a NEW edit request → new runId), drop the previous
  // run's apply results + selections. Otherwise a stale "All 4 changes applied"
  // report lingers over the new run's fresh proposals.
  useEffect(() => {
    resetResults();
    setSelected({});
    initializedRunId.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.runId]);

  // Only proposals not yet applied are actionable. Already-applied editIds are
  // persisted on the run, so a re-poll / "review remaining" shows just what's left.
  const remainingProposals = useMemo(() => {
    const applied = new Set(run?.appliedEditIds ?? []);
    return proposals.filter((p) => !applied.has(p.editId));
  }, [proposals, run?.appliedEditIds]);

  // Default every remaining proposal to selected once they arrive — ONCE per run.
  // Guarding on `initializedRunId` (not selection emptiness) means a later
  // revalidation can't re-select after the user deselected all / cherry-picked.
  useEffect(() => {
    if (
      status === 'PROPOSED' &&
      remainingProposals.length > 0 &&
      run?.runId &&
      initializedRunId.current !== run.runId
    ) {
      initializedRunId.current = run.runId;
      setSelected(Object.fromEntries(remainingProposals.map((p) => [p.editId, true])));
    }
  }, [status, remainingProposals, run?.runId]);

  const selectedIds = useMemo(
    () => remainingProposals.filter((p) => selected[p.editId]).map((p) => p.editId),
    [remainingProposals, selected],
  );

  const handleToggle = (editId: string, checked: boolean) =>
    setSelected((prev) => ({ ...prev, [editId]: checked }));

  const allSelected = remainingProposals.length > 0 && selectedIds.length === remainingProposals.length;
  // One toggle: select every remaining proposal, or clear the selection. The
  // clear path is the point — on a long run of mostly-useless proposals you
  // deselect all, then cherry-pick the few good ones instead of unchecking dozens.
  const handleToggleAll = () =>
    setSelected(
      allSelected ? {} : Object.fromEntries(remainingProposals.map((p) => [p.editId, true])),
    );

  const handleApply = async (resolveAfter = false) => {
    if (!run || selectedIds.length === 0) return;
    const applyResults = await applyEdits(run.runId, selectedIds);
    // Drop the just-applied selections; refresh pulls the run with its updated
    // appliedEditIds so "review remaining" shows only what's genuinely left.
    const applied = new Set((applyResults ?? []).filter((r) => r.status === 'applied').map((r) => r.editId));
    setSelected((prev) => {
      const next = { ...prev };
      for (const id of applied) delete next[id];
      return next;
    });
    await refresh();
    onApplied?.();
    // Resolve the originating finding only if the edit actually changed something.
    if (resolveAfter && applied.size > 0) await onResolveFinding?.();
  };

  if (isLoading && !run) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!run) return null;

  if (isProposing) {
    // The worker (15-min Lambda) normally finishes in well under a minute and
    // marks the run PROPOSED/FAILED. If it dies WITHOUT marking FAILED (OOM,
    // timeout, killed), the run would sit PROPOSING forever and this would spin
    // endlessly. After a generous bound, tell the user it likely failed and let
    // them retry, rather than an infinite spinner.
    const startedMs = run.startedAt ? Date.parse(run.startedAt) : NaN;
    const elapsedMin = Number.isNaN(startedMs) ? 0 : (Date.now() - startedMs) / 60_000;
    const likelyStuck = elapsedMin > 5;

    if (likelyStuck) {
      return (
        <div className="space-y-2">
          <Alert variant="destructive">
            <AlertDescription>
              This is taking longer than expected and may have failed. You can keep waiting, or discard
              it and try the request again.
            </AlertDescription>
          </Alert>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refresh()}>
              <Loader2 className="mr-1 h-3.5 w-3.5" />
              Check again
            </Button>
            {onDiscard && (
              <Button variant="ghost" size="sm" onClick={onDiscard}>
                <X className="mr-1 h-3.5 w-3.5" />
                Discard
              </Button>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-start gap-3 rounded-md border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950/40">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-indigo-600 dark:text-indigo-400" />
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-indigo-900 dark:text-indigo-100">
            Analyzing the package for changes…
          </p>
          <p className="text-xs text-indigo-700/80 dark:text-indigo-300/80">
            This runs in the background and usually takes under a minute. You can keep working — the
            proposed changes will appear here automatically when it&rsquo;s ready.
          </p>
        </div>
      </div>
    );
  }

  if (status === 'FAILED') {
    return (
      <div className="space-y-2">
        <Alert variant="destructive">
          <AlertDescription>
            {run.error ?? 'The proposal scan failed. Please try again.'}
          </AlertDescription>
        </Alert>
        {onDiscard && (
          <Button variant="outline" size="sm" onClick={onDiscard}>
            <X className="mr-1 h-3.5 w-3.5" />
            Try a different instruction
          </Button>
        )}
      </div>
    );
  }

  // PROPOSED
  if (results) {
    // "Review remaining" is only useful when proposals are still un-applied.
    // `remainingProposals` already excludes what's been applied (via the run's
    // appliedEditIds), so after a full apply there's nothing left and the report
    // stands alone; skipped/failed edits stay reviewable so they can be retried.
    const hasReviewable = remainingProposals.length > 0;
    return (
      <div className="space-y-3">
        <ApplyResultReport results={results} />
        {hasReviewable && (
          <Button variant="outline" size="sm" onClick={resetResults}>
            Review remaining proposals ({remainingProposals.length})
          </Button>
        )}
      </div>
    );
  }

  if (proposals.length === 0) {
    // Prefer the worker's truthful summary (e.g. "couldn't find 'x@y.com'") over a
    // misleading generic "no changes needed".
    return (
      <div className="space-y-2">
        <Alert>
          <AlertDescription>
            {run.summary?.trim() ||
              'No matching text was found for that request, so nothing was changed. Try naming the exact current value to change.'}
          </AlertDescription>
        </Alert>
        {onDiscard && (
          <Button variant="outline" size="sm" onClick={onDiscard}>
            <X className="mr-1 h-3.5 w-3.5" />
            Try a different instruction
          </Button>
        )}
      </div>
    );
  }

  if (remainingProposals.length === 0) {
    return (
      <Alert>
        <AlertDescription>All proposed edits from this run have been applied.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      {stale && (
        <Alert>
          <AlertDescription>
            The package changed since these proposals were drafted. Edits whose original text
            no longer matches will be safely skipped when you apply.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="link"
          onClick={handleToggleAll}
          disabled={isApplying}
          className="h-auto p-0 text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:no-underline"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {selectedIds.length} of {remainingProposals.length} selected
        </span>
      </div>

      <div className="space-y-2">
        {remainingProposals.map((proposal) => (
          <ProposalDiffCard
            key={proposal.editId}
            proposal={proposal}
            selected={!!selected[proposal.editId]}
            onToggle={handleToggle}
            disabled={isApplying}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => handleApply(false)} disabled={isApplying || selectedIds.length === 0}>
          {isApplying ? (
            <>
              <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Applying…
            </>
          ) : (
            `Apply ${selectedIds.length} edit${selectedIds.length === 1 ? '' : 's'}`
          )}
        </Button>
        {onResolveFinding && (
          <Button
            variant="outline"
            size="sm"
            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950"
            onClick={() => handleApply(true)}
            disabled={isApplying || selectedIds.length === 0}
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            Apply &amp; resolve finding
          </Button>
        )}
        {onDiscard && (
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={isApplying}>
            <X className="mr-1 h-3.5 w-3.5" />
            Discard
          </Button>
        )}
      </div>
    </div>
  );
};
