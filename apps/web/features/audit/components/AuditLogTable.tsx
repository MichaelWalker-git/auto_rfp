'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AuditLogRow } from './AuditLogRow';
import { AuditLogFilters } from './AuditLogFilters';
import { AuditLogTableSkeleton } from './AuditLogTableSkeleton';
import { useAuditLogs } from '../hooks/useAuditLogs';
import type { AuditLogFilters as Filters } from '../hooks/useAuditLogs';

interface AuditLogTableProps {
  orgId: string;
}

const COLUMNS = ['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'Result', 'IP Address', ''];

export const AuditLogTable = ({ orgId }: AuditLogTableProps) => {
  const [filters, setFilters] = useState<Filters>({ orgId });
  const { logs, count, nextToken, isLoading } = useAuditLogs(filters);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Log Viewer</CardTitle>
        <CardDescription>
          Immutable record of all user actions, system events, and security events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuditLogFilters orgId={orgId} onFilter={setFilters} />

        {isLoading ? (
          <AuditLogTableSkeleton />
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground border rounded-md bg-muted/20">
            No audit logs found for the selected filters.
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">{count} entries</p>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    {COLUMNS.map((col) => (
                      <TableHead key={col} className="text-xs font-medium h-9">
                        {col}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((entry) => (
                    <AuditLogRow key={entry.logId} entry={entry} />
                  ))}
                </TableBody>
              </Table>
            </div>

            {nextToken && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFilters((f) => ({ ...f, nextToken }))}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
