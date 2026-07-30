'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ExportCsvButton } from './ExportCsvButton';
import type { AgingRow } from '../lib/derive-metrics';

interface AgingTableProps {
  rows: AgingRow[];
  thresholdDays: number;
  onExport: () => void;
}

/** RFPs sitting in the same stage longer than the threshold, oldest first. */
export const AgingTable = ({ rows, thresholdDays, onExport }: AgingTableProps) => (
  <Card>
    <CardHeader className="flex flex-row items-start justify-between gap-2">
      <div>
        <CardTitle className="text-base">Aging</CardTitle>
        <CardDescription>RFPs stuck in a stage more than {thresholdDays} days</CardDescription>
      </div>
      <ExportCsvButton onExport={onExport} disabled={rows.length === 0} />
    </CardHeader>
    <CardContent>
      {rows.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
          Nothing is aging past {thresholdDays} days
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead className="text-right">Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.item.id}>
                <TableCell className="max-w-[18rem] truncate font-medium">{row.item.title}</TableCell>
                <TableCell>{row.label}</TableCell>
                <TableCell className="text-muted-foreground">{row.item.assigneeName ?? '—'}</TableCell>
                <TableCell className="text-right">
                  {/* No semantic "warning" token in the theme; amber is kept
                      intentionally to signal aging, with a dark-mode variant. */}
                  <Badge variant="outline" className="bg-amber-100 text-amber-700 tabular-nums dark:bg-amber-950 dark:text-amber-300">
                    {row.daysInStage}d
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </CardContent>
  </Card>
);
