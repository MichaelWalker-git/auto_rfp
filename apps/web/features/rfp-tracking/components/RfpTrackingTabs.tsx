'use client';

import { useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Clock, Download, RefreshCw } from 'lucide-react';
import { usePermission } from '@/components/permission-wrapper';
import { useCurrentOrganization } from '@/context/organization-context';
import { useRfpPipeline } from '../hooks/use-rfp-pipeline';
import { pendingApprovalCount } from '../lib/derive-approval-queue';
import { exportPipelineToCsv } from '../lib/export-csv';
import { PipelineBoard } from './PipelineBoard';
import { ApprovalQueue } from './ApprovalQueue';
import { NeedsAttentionPanel } from './NeedsAttentionPanel';
import { MetricsView } from './MetricsView';
import { deriveFlags } from '../lib/derive-flags';
import { formatRelativeTime } from '../lib/format';

interface RfpTrackingTabsProps {
  orgId: string;
  /** Injected for testability; defaults to the current time. */
  nowIso?: string;
}

/**
 * Top-level RFP-tracking view: four tabs — Board · Approval Queue ·
 * Needs Attention · Metrics. All data comes from a single org-wide pipeline
 * fetch and is derived client-side; the header offers CSV export and a manual
 * refresh. Approval authorization (rfp:approve_initial / rfp:approve_final) is
 * enforced server-side on the decision endpoint, so the queue actions render
 * for every org member.
 */
export function RfpTrackingTabs({ orgId, nowIso }: RfpTrackingTabsProps) {
  const now = nowIso ?? new Date().toISOString();
  const { items, isLoading, isError, mutate } = useRfpPipeline(orgId);
  const { currentOrganization } = useCurrentOrganization();
  const canAdvance = usePermission('opportunity:edit');

  const pendingCount = useMemo(() => pendingApprovalCount(items).total, [items]);
  const flagCount = useMemo(() => deriveFlags(items).length, [items]);

  // The board's effective last-sync time is the most recent syncedAt across all
  // items (each is stamped by the Linear sync). Ignore null/undefined.
  const lastSyncedAt = useMemo(() => {
    const stamps = items.map((item) => item.syncedAt).filter((s): s is string => Boolean(s));
    return stamps.length > 0 ? stamps.reduce((a, b) => (a > b ? a : b)) : null;
  }, [items]);

  const orgName = currentOrganization?.name ?? 'organization';

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-3">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center text-sm text-destructive">
        <p>Could not load the RFP pipeline.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => mutate()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        {lastSyncedAt && (
          <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Last synced {formatRelativeTime(lastSyncedAt, now)}
          </span>
        )}
        <Button variant="outline" size="sm" onClick={() => mutate()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={items.length === 0}
          onClick={() => exportPipelineToCsv(items, orgName, now)}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      <Tabs defaultValue="board" className="w-full">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="queue" className="gap-1.5">
            Approval Queue
            {pendingCount > 0 && (
              <Badge variant="outline" className="bg-primary/10 text-primary">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="attention" className="gap-1.5">
            Needs Attention
            {/* No semantic "warning" token exists in the theme; amber is kept
                intentionally for the needs-attention count. */}
            {flagCount > 0 && (
              <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {flagCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <PipelineBoard items={items} orgId={orgId} nowIso={now} canAdvance={canAdvance} />
        </TabsContent>
        <TabsContent value="queue" className="mt-4">
          <ApprovalQueue items={items} orgId={orgId} nowIso={now} />
        </TabsContent>
        <TabsContent value="attention" className="mt-4">
          <NeedsAttentionPanel items={items} orgId={orgId} />
        </TabsContent>
        <TabsContent value="metrics" className="mt-4">
          <MetricsView items={items} nowIso={now} orgId={orgId} orgName={orgName} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
