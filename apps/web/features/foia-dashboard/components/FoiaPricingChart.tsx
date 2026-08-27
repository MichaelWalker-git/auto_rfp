'use client';

import Link from 'next/link';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { FoiaPricingComparison, FoiaPricingCoverage } from '@auto-rfp/core';

const OUR_COLOR = '#6366f1';
const WINNER_COLOR = '#f43f5e';

/** Compact currency, so a $1.2M bar label does not wrap the axis. */
const formatCompactUsd = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

const formatFullUsd = (value: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);

/** Keeps an axis label readable without hiding which solicitation it is. */
const shortLabel = (row: FoiaPricingComparison): string =>
  row.solicitationNumber ?? (row.title.length > 22 ? `${row.title.slice(0, 21)}…` : row.title);

interface FoiaPricingChartProps {
  orgId: string;
  pricing: FoiaPricingComparison[] | undefined;
  coverage: FoiaPricingCoverage | undefined;
  isLoading: boolean;
}

/**
 * Our bid against the winning bid, for the most recent losses that have both figures.
 *
 * The coverage line below the chart is not decoration. These amounts are typed in on
 * the loss form — they are NOT extracted from the FOIA response PDF — so the chart can
 * legitimately show three bars while the org has forty losses on record. Without the
 * line, a reader would take three as the whole picture.
 */
export const FoiaPricingChart = ({
  orgId,
  pricing,
  coverage,
  isLoading,
}: FoiaPricingChartProps) => {
  /**
   * Series keys are the display labels.
   *
   * Naming them `ours`/`winner` and remapping in the tooltip formatter makes recharts
   * infer the name type from that formatter's return, which then conflicts with
   * `labelFormatter`'s signature. Labelling the keys directly is both simpler and
   * removes the need for a formatter at all.
   */
  const rows = (pricing ?? []).map((row) => ({
    name: shortLabel(row),
    'Our bid': row.ourBidAmount ?? 0,
    'Winning bid': row.winningBidAmount ?? 0,
    fullTitle: row.title,
    winningContractor: row.winningContractor,
  }));

  const missing = coverage ? coverage.total - coverage.withPricing : 0;

  return (
    <Card className="border">
      <CardHeader>
        <CardTitle className="text-base">Our Price vs Winning Price</CardTitle>
        <CardDescription>Most recent losses with both figures recorded</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : rows.length === 0 ? (
          <div className="flex h-56 flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
            <p>No pricing recorded yet.</p>
            <p className="max-w-sm text-xs">
              Bid amounts are entered on an opportunity&apos;s loss form. Once both our
              price and the winner&apos;s are recorded, the comparison appears here.
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={formatCompactUsd} />
              <Tooltip
                // Full amounts here — the axis is abbreviated, so the tooltip is where
                // the exact figure has to be legible.
                formatter={(value) => formatFullUsd(Number(value))}
                // The axis shows a solicitation number; the tooltip shows the title it
                // belongs to, since a number alone is not recognisable.
                labelFormatter={(label, payload) => payload?.[0]?.payload?.fullTitle ?? label}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--background))',
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Our bid" fill={OUR_COLOR} radius={[3, 3, 0, 0]} />
              <Bar dataKey="Winning bid" fill={WINNER_COLOR} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {/* Coverage, always shown once loaded — including when it is complete, so the
            absence of a warning is itself informative. */}
        {!isLoading && coverage && coverage.total > 0 && (
          <p className="border-t pt-2 text-xs text-muted-foreground">
            Showing {rows.length} of {coverage.total} recorded loss
            {coverage.total === 1 ? '' : 'es'}.{' '}
            {missing > 0 ? (
              <>
                {missing} {missing === 1 ? 'has' : 'have'} no bid amounts recorded —{' '}
                <Link
                  href={`/organizations/${orgId}/opportunities`}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  add them on the opportunity
                </Link>{' '}
                to include them.
              </>
            ) : (
              <>All recorded losses have bid amounts.</>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
