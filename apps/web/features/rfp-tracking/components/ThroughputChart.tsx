'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LabelList, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ExportCsvButton } from './ExportCsvButton';
import type { ThroughputBucket } from '../lib/derive-metrics';

interface ThroughputChartProps {
  data: ThroughputBucket[];
  onExport: () => void;
}

/** Submissions-per-week bar chart. */
export const ThroughputChart = ({ data, onExport }: ThroughputChartProps) => {
  const total = data.reduce((sum, b) => sum + b.count, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">Throughput</CardTitle>
          <CardDescription>RFPs submitted per week ({total} total)</CardDescription>
        </div>
        <ExportCsvButton onExport={onExport} disabled={data.length === 0} />
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            No submissions in this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={224}>
            <BarChart data={data} margin={{ top: 20, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }}
                labelFormatter={() => ''}
                formatter={(value: number) => [value, '']}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: '1px solid hsl(var(--border))',
                  background: 'hsl(var(--background))',
                }}
              />
              <Bar dataKey="count" name="Submitted" fill="#6366f1" radius={[3, 3, 0, 0]}>
                <LabelList
                  dataKey="count"
                  position="top"
                  fontSize={11}
                  fill="hsl(var(--foreground))"
                  formatter={(value: number) => (value === 0 ? '' : value)}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
};
