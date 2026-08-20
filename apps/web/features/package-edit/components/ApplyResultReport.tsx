'use client';

import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import type { EditApplyResult } from '@auto-rfp/core';

interface ApplyResultReportProps {
  results: EditApplyResult[];
}

// Collapse a list of per-target messages into "message ×N" so 65 identical
// "changed since proposed" lines read as one line, not a wall of warnings.
const summarizeMessages = (
  items: EditApplyResult[],
  fallback: string,
): Array<{ message: string; count: number }> => {
  const counts = new Map<string, number>();
  for (const r of items) {
    const key = r.message ?? fallback;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([message, count]) => ({ message, count }));
};

/**
 * Per-target apply summary. Leads with a clear, context-aware headline so an
 * all-skipped or all-applied run reads as a plain outcome, not an error dump.
 */
export const ApplyResultReport = ({ results }: ApplyResultReportProps) => {
  const applied = results.filter((r) => r.status === 'applied').length;
  const skipped = results.filter((r) => r.status === 'skipped-stale');
  const failed = results.filter((r) => r.status === 'failed');
  const total = results.length;

  // Headline + variant by outcome shape.
  let variant: 'default' | 'destructive' = 'default';
  let Icon = CheckCircle2;
  let headline: string;

  if (applied === total) {
    headline = `All ${total} change${total === 1 ? '' : 's'} applied.`;
  } else if (applied > 0) {
    headline =
      `${applied} of ${total} applied` +
      (skipped.length ? ` · ${skipped.length} skipped` : '') +
      (failed.length ? ` · ${failed.length} failed` : '') +
      '.';
    Icon = Info;
  } else if (failed.length > 0 && skipped.length === 0) {
    headline = `None applied — ${failed.length} failed.`;
    Icon = XCircle;
    variant = 'destructive';
  } else {
    // Everything skipped as stale — the common "nothing left to change" outcome.
    headline =
      `No changes applied — the package no longer matches these proposals ` +
      `(it was edited since they were drafted). Re-run the edit to get fresh proposals.`;
    Icon = Info;
  }

  const skippedSummary = summarizeMessages(skipped, 'Changed since proposed.');
  const failedSummary = summarizeMessages(failed, 'Failed to apply.');

  return (
    <div className="space-y-2">
      <Alert variant={variant}>
        <Icon className="h-4 w-4" />
        <AlertDescription>{headline}</AlertDescription>
      </Alert>

      {/* Only show the detail breakdown when something actually applied — an
          all-skipped run is fully explained by the headline. */}
      {applied > 0 && skippedSummary.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {skippedSummary.map(({ message, count }) => (
            <li key={message} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <span>
                {message}
                {count > 1 && ` (×${count})`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {failedSummary.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {failedSummary.map(({ message, count }) => (
            <li key={message} className="flex items-start gap-1.5">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
              <span>
                {message}
                {count > 1 && ` (×${count})`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
