'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { AuditLogEntry } from '@auto-rfp/core';

interface AuditLogRowProps {
  entry: AuditLogEntry;
}

export const AuditLogRow = ({ entry }: AuditLogRowProps) => {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = !!entry.changes;
  const isFailure = entry.result === 'failure';

  return (
    <>
      <TableRow className={cn(isFailure && 'bg-red-50/50 hover:bg-red-50')}>
        {/* Timestamp */}
        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
          {format(new Date(entry.timestamp), 'MMM d, yyyy HH:mm:ss')}
        </TableCell>

        {/* User */}
        <TableCell className="text-xs">
          <span className="font-medium">{entry.userName}</span>
          <span className="block text-muted-foreground font-mono text-[10px] truncate max-w-[120px]">
            {entry.userId}
          </span>
        </TableCell>

        {/* Action */}
        <TableCell>
          <Badge variant="secondary" className="text-[10px] font-mono">
            {entry.action}
          </Badge>
        </TableCell>

        {/* Resource */}
        <TableCell className="text-xs text-muted-foreground capitalize">
          {entry.resource}
        </TableCell>

        {/* Resource ID */}
        <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-[100px]" title={entry.resourceId}>
          {entry.resourceId}
        </TableCell>

        {/* Result */}
        <TableCell>
          <Badge variant={isFailure ? 'destructive' : 'default'} className="text-xs">
            {entry.result}
          </Badge>
        </TableCell>

        {/* IP */}
        <TableCell className="text-xs text-muted-foreground font-mono">
          {entry.ipAddress}
        </TableCell>

        {/* Expand toggle */}
        <TableCell className="w-8">
          {hasChanges && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded
                ? <ChevronDown className="h-3 w-3" />
                : <ChevronRight className="h-3 w-3" />}
            </Button>
          )}
        </TableCell>
      </TableRow>

      {/* Expanded diff row */}
      {expanded && hasChanges && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={8} className="px-6 py-3">
            <div className="grid grid-cols-2 gap-4 text-xs">
              {entry.changes?.before !== undefined && (
                <div>
                  <p className="font-semibold text-muted-foreground mb-1">Before</p>
                  <pre className="bg-background border rounded-md p-2 overflow-auto max-h-40 text-foreground text-[11px]">
                    {JSON.stringify(entry.changes.before, null, 2)}
                  </pre>
                </div>
              )}
              {entry.changes?.after !== undefined && (
                <div>
                  <p className="font-semibold text-muted-foreground mb-1">After</p>
                  <pre className="bg-background border rounded-md p-2 overflow-auto max-h-40 text-foreground text-[11px]">
                    {JSON.stringify(entry.changes.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            {entry.errorMessage && (
              <p className="mt-2 text-xs text-destructive">
                <span className="font-medium">Error:</span> {entry.errorMessage}
              </p>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
};
