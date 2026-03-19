'use client';

import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
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
const PAGE_SIZE = 50;

export const AuditLogTable = ({ orgId }: AuditLogTableProps) => {
  const [filters, setFilters] = useState<Filters>({ orgId, limit: PAGE_SIZE });
  // Track pagination history: array of tokens (undefined for first page)
  const [tokenHistory, setTokenHistory] = useState<(string | undefined)[]>([undefined]);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  
  const { logs, count, nextToken, isLoading } = useAuditLogs(filters);

  // Calculate pagination info
  const currentPage = currentPageIndex + 1;
  const hasNextPage = !!nextToken;
  const hasPrevPage = currentPageIndex > 0;

  // Handle filter changes - reset pagination
  const handleFilter = useCallback((newFilters: Filters) => {
    setFilters({ ...newFilters, limit: PAGE_SIZE, nextToken: undefined });
    setTokenHistory([undefined]);
    setCurrentPageIndex(0);
  }, []);

  // Navigate to next page
  const goToNextPage = useCallback(() => {
    if (!nextToken) return;
    
    // Add the next token to history if we're moving forward
    const newHistory = [...tokenHistory];
    if (currentPageIndex === tokenHistory.length - 1) {
      newHistory.push(nextToken);
    }
    setTokenHistory(newHistory);
    setCurrentPageIndex(currentPageIndex + 1);
    setFilters((f) => ({ ...f, nextToken }));
  }, [nextToken, tokenHistory, currentPageIndex]);

  // Navigate to previous page
  const goToPrevPage = useCallback(() => {
    if (currentPageIndex === 0) return;
    
    const prevIndex = currentPageIndex - 1;
    const prevToken = tokenHistory[prevIndex];
    setCurrentPageIndex(prevIndex);
    setFilters((f) => ({ ...f, nextToken: prevToken }));
  }, [currentPageIndex, tokenHistory]);

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">Log Viewer</CardTitle>
        <CardDescription>
          Immutable record of all user actions, system events, and security events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuditLogFilters orgId={orgId} onFilter={handleFilter} />

        {isLoading ? (
          <AuditLogTableSkeleton />
        ) : logs.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground border rounded-md bg-muted/20">
            No audit logs found for the selected filters.
          </div>
        ) : (
          <>
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

            {/* Pagination Controls */}
            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                {count} total entries
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToPrevPage}
                  disabled={!hasPrevPage || isLoading}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground px-2">
                  Page {currentPage}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={goToNextPage}
                  disabled={!hasNextPage || isLoading}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
