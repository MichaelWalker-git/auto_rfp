'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ExportCsvButton } from './ExportCsvButton';
import type { CycleTimeSummary } from '../lib/derive-metrics';

interface CycleTimeTableProps {
  summary: CycleTimeSummary;
  onExport: () => void;
}

const days = (value: number | null): string => (value === null ? '—' : `${value.toFixed(1)}d`);

/** Average AND median days per stage, plus total found-to-submitted. */
export const CycleTimeTable = ({ summary, onExport }: CycleTimeTableProps) => (
  <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Cycle Time</CardTitle>
          <Badge variant="secondary" className="text-[10px] font-normal">Last 60 days</Badge>
        </div>
        <CardDescription>Average and median days for RFPs submitted in the last 60 days</CardDescription>
      </div>
      <ExportCsvButton onExport={onExport} />
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Avg</TableHead>
            <TableHead className="text-right">Median</TableHead>
            <TableHead className="text-right">n</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {summary.perStage.map((row) => (
            <TableRow key={row.stage}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{days(row.avgDays)}</TableCell>
              <TableCell className="text-right tabular-nums">{days(row.medianDays)}</TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">{row.n}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-medium">Total (Found → Submitted)</TableCell>
            <TableCell className="text-right tabular-nums">{days(summary.foundToSubmitted.avgDays)}</TableCell>
            <TableCell className="text-right tabular-nums">{days(summary.foundToSubmitted.medianDays)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">{summary.foundToSubmitted.n}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
      <p className="mt-2 text-xs text-muted-foreground">
        Durations accrue as records advance across syncs; freshly-synced items show n=0 until they
        transition, and gates crossed within a single sync interval record as 0 days.
      </p>
    </CardContent>
  </Card>
);
