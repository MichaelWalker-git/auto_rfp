'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExportCsvButton } from './ExportCsvButton';
import type { OutcomeSlice } from '../lib/derive-metrics';

interface OutcomeDonutProps {
  slices: OutcomeSlice[];
  onExport: () => void;
}

/** Donut breakdown of Awarded / Lost / No Response / Pending / Not Approved. */
export const OutcomeDonut = ({ slices, onExport }: OutcomeDonutProps) => {
  const total = slices.reduce((sum, s) => sum + s.count, 0);
  const nonEmpty = slices.filter((s) => s.count > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Outcome Breakdown</CardTitle>
          <CardDescription>Where RFPs landed this period ({total} total)</CardDescription>
        </div>
        <ExportCsvButton onExport={onExport} disabled={total === 0} />
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            No outcomes in this period
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
                    <Cell key={slice.key} fill={slice.color} />
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
            <div className="flex-1 space-y-1.5">
              {slices.map((slice) => (
                <div key={slice.key} className="flex items-center gap-2 text-xs">
                  <div className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
                  <span className="truncate text-muted-foreground">{slice.label}</span>
                  <span className="ml-auto shrink-0 font-medium tabular-nums">{slice.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
