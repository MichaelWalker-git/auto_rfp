'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { FOIA_OUTCOME_BUCKET_LABELS } from '@auto-rfp/core';
import type { FoiaDashboardCounts, FoiaOutcomeBucket } from '@auto-rfp/core';

/**
 * Colours per bucket.
 *
 * Emerald for won and rose for lost follow the project's semantic palette. The other
 * two are deliberately NEUTRAL: an agency holding no records, or a cancelled
 * solicitation, is neither a good nor a bad result — colouring them like a loss would
 * assert a judgement the data does not support.
 */
const BUCKET_COLORS: Record<FoiaOutcomeBucket, string> = {
  WON: '#10b981',
  LOST: '#f43f5e',
  NOT_PRESENT: '#94a3b8',
  CANCELLED: '#64748b',
};

const BUCKET_ORDER: FoiaOutcomeBucket[] = ['WON', 'LOST', 'NOT_PRESENT', 'CANCELLED'];

const BUCKET_HINTS: Record<FoiaOutcomeBucket, string> = {
  WON: 'We were awarded the contract',
  LOST: 'Awarded to another bidder',
  NOT_PRESENT: 'The agency reported it holds no records for us',
  CANCELLED: 'Solicitation cancelled — detected from agency email',
};

interface FoiaOutcomeDonutProps {
  counts: FoiaDashboardCounts | undefined;
  isLoading: boolean;
}

/** Won / Lost / No records held / Cancelled split across every tracked FOIA. */
export const FoiaOutcomeDonut = ({ counts, isLoading }: FoiaOutcomeDonutProps) => {
  const slices = BUCKET_ORDER.map((bucket) => ({
    bucket,
    label: FOIA_OUTCOME_BUCKET_LABELS[bucket],
    count: counts?.[bucket] ?? 0,
    color: BUCKET_COLORS[bucket],
  }));

  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const nonEmpty = slices.filter((slice) => slice.count > 0);

  return (
    <Card className="border">
      <CardHeader>
        <CardTitle className="text-base">FOIA Outcomes</CardTitle>
        <CardDescription>
          {isLoading ? 'Loading…' : `${total} tracked solicitation${total === 1 ? '' : 's'}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : total === 0 ? (
          <div className="flex h-56 items-center justify-center text-center text-sm text-muted-foreground">
            No completed solicitations yet. Outcomes appear here once an opportunity is
            marked won or lost.
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={220}>
              <PieChart>
                <Pie
                  data={nonEmpty}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="count"
                  nameKey="label"
                >
                  {nonEmpty.map((slice) => (
                    <Cell key={slice.bucket} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 8,
                    border: '1px solid hsl(var(--border))',
                    background: 'hsl(var(--background))',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {slices.map((slice) => (
                <div key={slice.bucket} className="text-xs">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ backgroundColor: slice.color }}
                    />
                    <span className="truncate text-muted-foreground">{slice.label}</span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums">
                      {slice.count}
                    </span>
                  </div>
                  {/* Spelled out because "No records held" is otherwise easy to
                      misread as a missing value rather than an agency's answer. */}
                  <p className="ml-[18px] text-[11px] leading-tight text-muted-foreground/70">
                    {BUCKET_HINTS[slice.bucket]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
