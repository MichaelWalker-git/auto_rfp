'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatDistanceToNow, format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  CloudOff,
  ArrowUpRight,
} from 'lucide-react';
import { ApnRetryButton } from './ApnRetryButton';
import { useApnRegistrations } from '../hooks/useApnRegistrations';
import type { ApnRegistrationItem, ApnRegistrationStatus } from '@auto-rfp/core';

interface ApnRegistrationListProps {
  orgId: string;
}

const STATUS_BADGE: Record<
  ApnRegistrationStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.ReactNode }
> = {
  PENDING:        { label: 'Pending',        variant: 'secondary',    icon: <Clock className="h-3 w-3" /> },
  REGISTERED:     { label: 'Registered',     variant: 'default',      icon: <CheckCircle2 className="h-3 w-3" /> },
  FAILED:         { label: 'Failed',         variant: 'destructive',  icon: <AlertTriangle className="h-3 w-3" /> },
  RETRYING:       { label: 'Retrying',       variant: 'secondary',    icon: <RefreshCw className="h-3 w-3 animate-spin" /> },
  NOT_CONFIGURED: { label: 'Not Configured', variant: 'outline',      icon: <CloudOff className="h-3 w-3" /> },
};

const ALL_STATUSES: ApnRegistrationStatus[] = [
  'PENDING', 'REGISTERED', 'FAILED', 'RETRYING', 'NOT_CONFIGURED',
];

const TableSkeleton = () => {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
};

const StatusBadge = ({ status }: { status: ApnRegistrationStatus }) => {
  const cfg = STATUS_BADGE[status];
  return (
    <Badge variant={cfg.variant} className="gap-1 text-xs">
      {cfg.icon}
      {cfg.label}
    </Badge>
  );
};

const RegistrationRow = ({
  item,
  orgId,
  onRetrySuccess,
}: {
  item: ApnRegistrationItem;
  orgId: string;
  onRetrySuccess: () => void;
}) => {
  return (
    <TableRow>
      {/* Status */}
      <TableCell>
        <StatusBadge status={item.status} />
      </TableCell>

      {/* Customer */}
      <TableCell className="font-medium max-w-[180px] truncate">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate block">{item.customerName}</span>
          </TooltipTrigger>
          <TooltipContent>{item.customerName}</TooltipContent>
        </Tooltip>
      </TableCell>

      {/* Opportunity */}
      <TableCell>
        <Link
          href={`/organizations/${orgId}/projects/${item.projectId}/opportunities/${item.oppId}`}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <span className="font-mono">{item.oppId.substring(0, 8)}…</span>
          <ArrowUpRight className="h-3 w-3 shrink-0" />
        </Link>
      </TableCell>

      {/* Value */}
      <TableCell className="text-sm tabular-nums">
        {item.opportunityValue > 0
          ? `$${item.opportunityValue.toLocaleString()}`
          : <span className="text-muted-foreground">—</span>}
      </TableCell>

      {/* APN ID */}
      <TableCell>
        {item.apnOpportunityId ? (
          <div className="flex items-center gap-1">
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
              {item.apnOpportunityId.substring(0, 12)}…
            </code>
            {item.apnOpportunityUrl && (
              <a
                href={item.apnOpportunityUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:opacity-70"
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>

      {/* Registered */}
      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
        {item.lastAttemptAt
          ? (
            <Tooltip>
              <TooltipTrigger>
                {formatDistanceToNow(new Date(item.lastAttemptAt), { addSuffix: true })}
              </TooltipTrigger>
              <TooltipContent>
                {format(new Date(item.lastAttemptAt), 'MMM d, yyyy HH:mm')}
              </TooltipContent>
            </Tooltip>
          )
          : <span>—</span>}
      </TableCell>

      {/* Retries */}
      <TableCell className="text-xs text-center tabular-nums">
        {item.retryCount > 0
          ? <span className="text-muted-foreground">{item.retryCount}</span>
          : <span className="text-muted-foreground">—</span>}
      </TableCell>

      {/* Actions */}
      <TableCell>
        {item.status === 'FAILED' && (
          <ApnRetryButton registration={item} onSuccess={onRetrySuccess} />
        )}
      </TableCell>
    </TableRow>
  );
}

export const ApnRegistrationList = ({ orgId }: ApnRegistrationListProps) => {
  const { registrations, count, isLoading, refresh } = useApnRegistrations(orgId);
  const [statusFilter, setStatusFilter] = useState<ApnRegistrationStatus | 'ALL'>('ALL');

  const filtered = statusFilter === 'ALL'
    ? registrations
    : registrations.filter((r) => r.status === statusFilter);

  const failedCount = registrations.filter((r) => r.status === 'FAILED').length;
  const registeredCount = registrations.filter((r) => r.status === 'REGISTERED').length;

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-base">APN Registrations</CardTitle>
            <CardDescription className="mt-1">
              All proposal submissions registered with AWS Partner Central
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refresh()}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        {/* Summary stats */}
        {!isLoading && count > 0 && (
          <div className="flex items-center gap-3 pt-2">
            <span className="text-xs text-muted-foreground">{count} total</span>
            {registeredCount > 0 && (
              <Badge variant="default" className="gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3" />
                {registeredCount} registered
              </Badge>
            )}
            {failedCount > 0 && (
              <Badge variant="destructive" className="gap-1 text-xs">
                <AlertTriangle className="h-3 w-3" />
                {failedCount} failed
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filter */}
        {!isLoading && count > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Filter by status:</span>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as ApnRegistrationStatus | 'ALL')}
            >
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {ALL_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_BADGE[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-sm text-muted-foreground border rounded-md bg-muted/20 gap-2">
            {count === 0 ? (
              <>
                <CloudOff className="h-8 w-8 text-muted-foreground/40" />
                <p>No APN registrations yet.</p>
                <p className="text-xs">Registrations are created automatically when proposals are submitted.</p>
              </>
            ) : (
              <p>No registrations match the selected filter.</p>
            )}
          </div>
        ) : (
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-xs font-medium h-9 w-28">Status</TableHead>
                  <TableHead className="text-xs font-medium h-9">Customer</TableHead>
                  <TableHead className="text-xs font-medium h-9">Opportunity</TableHead>
                  <TableHead className="text-xs font-medium h-9">Value</TableHead>
                  <TableHead className="text-xs font-medium h-9">APN ID</TableHead>
                  <TableHead className="text-xs font-medium h-9">Last Attempt</TableHead>
                  <TableHead className="text-xs font-medium h-9 text-center">Retries</TableHead>
                  <TableHead className="text-xs font-medium h-9 w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <RegistrationRow
                    key={item.registrationId}
                    item={item}
                    orgId={orgId}
                    onRetrySuccess={refresh}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
