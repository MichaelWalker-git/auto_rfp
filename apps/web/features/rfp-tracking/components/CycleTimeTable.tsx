'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
        <CardTitle className="text-base">Cycle Time</CardTitle>
        <CardDescription>Average and median days spent per stage</CardDescription>
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
    </CardContent>
  </Card>
);
