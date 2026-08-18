'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { FoiaScoreComparison as FoiaScoreComparisonRow } from '@auto-rfp/core';

/** The criteria on EvaluationScoresSchema, in the order a scoring sheet lists them. */
const CRITERIA = [
  { key: 'technical', label: 'Technical' },
  { key: 'price', label: 'Price' },
  { key: 'pastPerformance', label: 'Past performance' },
  { key: 'management', label: 'Management' },
  { key: 'overall', label: 'Overall' },
] as const;

/** How many solicitations to detail before the list becomes a wall. */
const MAX_ROWS = 3;

/**
 * One score bar, or nothing when the score is undisclosed.
 *
 * Returning null rather than a zero-width bar is deliberate: a flat bar at the origin
 * reads as "scored 0", which is a different and much worse claim than "not disclosed".
 */
const ScoreBar = ({
  value,
  className,
  label,
}: {
  value: number | undefined;
  className: string;
  label: string;
}) => {
  if (typeof value !== 'number') return null;

  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={`${label} ${value}`}
    >
      <div
        className={`h-full rounded-full transition-all duration-500 ${className}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
};

interface FoiaScoreComparisonProps {
  scores: FoiaScoreComparisonRow[] | undefined;
  isLoading: boolean;
}

/**
 * Per-criterion evaluation scores from debriefs and FOIA responses.
 *
 * Bars rather than a chart: five criteria across a couple of solicitations is a table
 * of numbers, and a recharts grouped bar would add axes and a legend without adding
 * information.
 *
 * Both sides are shown when both are on file: our score, the winner's, and the gap.
 * Either side alone still renders — an agency can disclose the awardee's score on a
 * criterion it never scored us on, and that asymmetry is itself the finding. An
 * undisclosed score is an em dash with NO bar, never a 0 with a flat one.
 */
export const FoiaScoreComparison = ({ scores, isLoading }: FoiaScoreComparisonProps) => {
  const rows = (scores ?? []).slice(0, MAX_ROWS);
  const hidden = (scores?.length ?? 0) - rows.length;

  return (
    <Card className="border">
      <CardHeader>
        <CardTitle className="text-base">Evaluation Scores</CardTitle>
        <CardDescription>Our score vs the winner&apos;s, per criterion</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : rows.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <p>No evaluation scores recorded yet.</p>
            <p className="max-w-sm text-xs">
              Scores come from a debrief or a released scoring sheet, entered on the
              opportunity&apos;s loss form.
            </p>
          </div>
        ) : (
          <>
            {rows.map((row) => {
              // Either side qualifies: a release can disclose the winner's score on a
              // criterion the agency never scored us on, and that gap is itself the
              // finding.
              const present = CRITERIA.filter(
                (c) =>
                  typeof row.ourScores[c.key] === 'number' ||
                  typeof row.winnerScores?.[c.key] === 'number',
              );

              return (
                <div key={row.oppId} className="space-y-2">
                  <div>
                    <p className="truncate text-sm font-medium">{row.title}</p>
                    {row.agencyName && (
                      <p className="truncate text-xs text-muted-foreground">{row.agencyName}</p>
                    )}
                  </div>

                  {present.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No criteria scored.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {present.map((criterion) => {
                        const ours = row.ourScores[criterion.key];
                        const theirs = row.winnerScores?.[criterion.key];
                        const gap =
                          typeof ours === 'number' && typeof theirs === 'number'
                            ? ours - theirs
                            : undefined;

                        return (
                          <div key={criterion.key} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{criterion.label}</span>
                              <span className="tabular-nums">
                                {/* An em dash, not a 0: an undisclosed score is unknown,
                                    and rendering it as zero would invent a result. */}
                                <span className="font-medium">
                                  {typeof ours === 'number' ? ours : '—'}
                                </span>
                                <span className="text-muted-foreground"> vs </span>
                                <span className="font-medium">
                                  {typeof theirs === 'number' ? theirs : '—'}
                                </span>
                                {gap !== undefined && gap !== 0 && (
                                  <span
                                    className={
                                      gap > 0
                                        ? 'ml-1.5 text-emerald-600'
                                        : 'ml-1.5 text-destructive'
                                    }
                                  >
                                    {gap > 0 ? `+${gap}` : gap}
                                  </span>
                                )}
                              </span>
                            </div>

                            {/* Two stacked bars: ours indigo, the winner's rose. Same
                                idiom as the dashboard's loss-reason block. A missing
                                side renders no bar rather than a zero-width one, so
                                "undisclosed" cannot be misread as "scored zero". */}
                            <ScoreBar value={ours} className="bg-indigo-500" label="ours" />
                            <ScoreBar value={theirs} className="bg-rose-500" label="winner" />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!row.winnerScores && (
                    <p className="text-[11px] leading-tight text-muted-foreground/70">
                      Winner&apos;s scores not on file — request the consensus scoring
                      worksheets, then record them on the loss form to compare.
                    </p>
                  )}
                </div>
              );
            })}

            {hidden > 0 && (
              <p className="border-t pt-2 text-xs text-muted-foreground">
                {hidden} more scored solicitation{hidden === 1 ? '' : 's'} not shown.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
