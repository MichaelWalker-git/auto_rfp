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
 * Only OUR scores exist today (`LossData.evaluationScores`). The winner's are carried
 * on the schema but never populated, so this renders one bar per criterion and says so
 * — showing an empty second bar would imply a comparison we do not have.
 */
export const FoiaScoreComparison = ({ scores, isLoading }: FoiaScoreComparisonProps) => {
  const rows = (scores ?? []).slice(0, MAX_ROWS);
  const hidden = (scores?.length ?? 0) - rows.length;

  return (
    <Card className="border">
      <CardHeader>
        <CardTitle className="text-base">Evaluation Scores</CardTitle>
        <CardDescription>How we were scored, per criterion</CardDescription>
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
              const present = CRITERIA.filter(
                (c) => typeof row.ourScores[c.key] === 'number',
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
                        const value = row.ourScores[criterion.key] as number;
                        return (
                          <div key={criterion.key} className="space-y-0.5">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-muted-foreground">{criterion.label}</span>
                              <span className="font-medium tabular-nums">{value}</span>
                            </div>
                            {/* Same bar idiom as the dashboard's loss-reason block. */}
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!row.winnerScores && (
                    <p className="text-[11px] leading-tight text-muted-foreground/70">
                      Winner&apos;s scores not on file — request the consensus scoring
                      worksheets to compare.
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
