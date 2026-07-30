'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { WinRateResult } from '../lib/derive-metrics';

interface WinRateCardProps {
  result: WinRateResult;
}

/** Win rate = Awarded / Submitted, with the raw counts (e.g. "0 of 16"). */
export const WinRateCard = ({ result }: WinRateCardProps) => (
  <Card>
    <CardHeader>
      <CardTitle className="text-base">Win Rate</CardTitle>
      <CardDescription>Awarded of submitted this period</CardDescription>
    </CardHeader>
    <CardContent>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-semibold tabular-nums">
          {result.rate === null ? '—' : `${result.rate.toFixed(0)}%`}
        </span>
        <span className="text-sm text-muted-foreground">
          {result.awarded} of {result.submitted} submitted
        </span>
      </div>
    </CardContent>
  </Card>
);
