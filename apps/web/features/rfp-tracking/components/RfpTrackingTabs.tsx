'use client';

import { useMemo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Download, RefreshCw } from 'lucide-react';
import { usePermission } from '@/components/permission-wrapper';
import { useCurrentOrganization } from '@/context/organization-context';
import { useRfpPipeline } from '../hooks/use-rfp-pipeline';
import { pendingApprovalCount } from '../lib/derive-approval-queue';
import { exportPipelineToCsv } from '../lib/export-csv';
import { PipelineBoard } from './PipelineBoard';
import { ApprovalQueue } from './ApprovalQueue';
import { NeedsAttentionPanel } from './NeedsAttentionPanel';
import { deriveFlags } from '../lib/derive-flags';

interface RfpTrackingTabsProps {
  orgId: string;
  /** Injected for testability; defaults to the current time. */
  nowIso?: string;
}

/**
 * Top-level RFP-tracking view: Board · Approval Queue · Needs Attention.
 * All data comes from a single org-wide pipeline fetch and is derived
 * client-side; the header offers CSV export and a manual refresh.
 */
export function RfpTrackingTabs({ orgId, nowIso }: RfpTrackingTabsProps) {
  const now = nowIso ?? new Date().toISOString();
  const { items, isLoading, isError, mutate } = useRfpPipeline(orgId);
  const { currentOrganization } = useCurrentOrganization();
  const canApproveInitial = usePermission('rfp:approve_initial');
  const canApproveFinal = usePermission('rfp:approve_final');
  const canAdvance = usePermission('opportunity:edit');

  const pendingCount = useMemo(() => pendingApprovalCount(items).total, [items]);
  const flagCount = useMemo(() => deriveFlags(items).length, [items]);

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
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
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
              <Badge variant="outline" className="bg-blue-100 text-blue-700">
                {pendingCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="attention" className="gap-1.5">
            Needs Attention
            {flagCount > 0 && (
              <Badge variant="outline" className="bg-amber-100 text-amber-700">
                {flagCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-4">
          <PipelineBoard items={items} orgId={orgId} nowIso={now} canAdvance={canAdvance} />
        </TabsContent>
        <TabsContent value="queue" className="mt-4">
          <ApprovalQueue
            items={items}
            orgId={orgId}
            nowIso={now}
            canApproveInitial={canApproveInitial}
            canApproveFinal={canApproveFinal}
          />
        </TabsContent>
        <TabsContent value="attention" className="mt-4">
          <NeedsAttentionPanel items={items} orgId={orgId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
