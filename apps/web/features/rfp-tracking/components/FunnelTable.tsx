'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ExportCsvButton } from './ExportCsvButton';
import type { FunnelRow } from '../lib/derive-metrics';

interface FunnelTableProps {
  rows: FunnelRow[];
  onExport: () => void;
}

const formatPercent = (value: number | null): string => (value === null ? '—' : `${value.toFixed(0)}%`);

/** Ordered funnel table: items entering each stage + stage-to-stage conversion. */
export const FunnelTable = ({ rows, onExport }: FunnelTableProps) => (
  <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-2">
      <div>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">Funnel</CardTitle>
          <Badge variant="secondary" className="text-[10px] font-normal">Last 60 days</Badge>
        </div>
        <CardDescription>
          Intake cohort from the last 60 days, followed through each stage — conversion is the
          share of the previous stage that advanced
        </CardDescription>
      </div>
      <ExportCsvButton onExport={onExport} disabled={rows.length === 0} />
    </CardHeader>
    <CardContent>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stage</TableHead>
            <TableHead className="text-right">Reached</TableHead>
            <TableHead className="text-right">Conversion</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.stage}>
              <TableCell className="font-medium">{row.label}</TableCell>
              <TableCell className="text-right tabular-nums">{row.entered}</TableCell>
              <TableCell className="text-right">
                {row.conversionFromPrev === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Badge variant="outline" className="tabular-nums">
                    {formatPercent(row.conversionFromPrev)}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardContent>
  </Card>
);
