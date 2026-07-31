'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X } from 'lucide-react';
import type { RfpPipelineItem } from '@auto-rfp/core';
import {
  deriveInitialQueue,
  deriveFinalQueue,
  type ApprovalQueueEntry,
} from '../lib/derive-approval-queue';
import { useApprovalDecision } from '../hooks/use-approval-decision';
import {
  formatCurrency,
  formatDaysWaiting,
  DEADLINE_BADGE_CLASSES,
  deadlineLabel,
} from '../lib/format';
import { cn } from '@/lib/utils';

interface ApprovalQueueProps {
  items: RfpPipelineItem[];
  orgId: string;
  nowIso: string;
}

/**
 * Two approval queues stacked: gate 1 (Initial Approval) and gate 2
 * (Pre-Submission Approval). Approve/Reject render for every org member —
 * authorization (rfp:approve_initial / rfp:approve_final) is enforced
 * server-side on the decision endpoint.
 */
export function ApprovalQueue({
  items,
  orgId,
  nowIso,
}: ApprovalQueueProps) {
  const initialQueue = useMemo(() => deriveInitialQueue(items, nowIso), [items, nowIso]);
  const finalQueue = useMemo(() => deriveFinalQueue(items, nowIso), [items, nowIso]);
  const { decide, pendingOppId, error } = useApprovalDecision(orgId);

  if (initialQueue.length === 0 && finalQueue.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
        Nothing is waiting for approval.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <QueueSection
        title="Awaiting Initial Approval"
        emptyLabel="Nothing is waiting for initial approval."
        queue={initialQueue}
        orgId={orgId}
        // Approval is open to every org member; the backend enforces authorization.
        canApprove
        pendingOppId={pendingOppId}
        onApprove={(projectId, oppId) => decide({ projectId, oppId, gate: 'INITIAL', decision: 'APPROVE' })}
        onReject={(projectId, oppId) => decide({ projectId, oppId, gate: 'INITIAL', decision: 'REJECT' })}
      />

      <QueueSection
        title="Awaiting Pre-Submission Approval"
        emptyLabel="Nothing is waiting for pre-submission approval."
        queue={finalQueue}
        orgId={orgId}
        // Approval is open to every org member; the backend enforces authorization.
        canApprove
        pendingOppId={pendingOppId}
        onApprove={(projectId, oppId) => decide({ projectId, oppId, gate: 'FINAL', decision: 'APPROVE' })}
      />
    </div>
  );
}

interface QueueSectionProps {
  title: string;
  emptyLabel: string;
  queue: ApprovalQueueEntry[];
  orgId: string;
  canApprove: boolean;
  pendingOppId: string | null;
  onApprove: (projectId: string, oppId: string) => void;
  /** Reject is only meaningful at gate 1; omit for gate 2. */
  onReject?: (projectId: string, oppId: string) => void;
}

function QueueSection({
  title,
  emptyLabel,
  queue,
  orgId,
  canApprove,
  pendingOppId,
  onApprove,
  onReject,
}: QueueSectionProps) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">
        {title}
        <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
          {queue.length}
        </Badge>
      </h3>

      {queue.length === 0 ? (
        <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
          {emptyLabel}
        </p>
      ) : (
        <Table className="table-fixed">
          <colgroup>
            <col className="w-[34%]" />
            <col className="w-[16%]" />
            <col className="w-[12%]" />
            <col className="w-[12%]" />
            <col className="w-[10%]" />
            {canApprove && <col className="w-[16%]" />}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>Opportunity</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Waiting</TableHead>
              {canApprove && <TableHead className="text-right">Decision</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {queue.map(({ item, daysWaiting, deadlineUrgency, daysToDeadline }) => {
              const oppId = item.oppId ?? item.id;
              const isPending = pendingOppId === oppId;
              const detailHref =
                item.projectId && oppId
                  ? `/organizations/${orgId}/projects/${item.projectId}/opportunities/${oppId}`
                  : null;

              return (
                <TableRow key={item.id}>
                  <TableCell className="min-w-0 overflow-hidden pr-4 align-top whitespace-normal">
                    {detailHref ? (
                      <Link
                        href={detailHref}
                        title={item.title}
                        className="block break-words font-medium text-primary hover:underline"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <span
                        title={item.title}
                        className="block break-words font-medium"
                      >
                        {item.title}
                      </span>
                    )}
                    {item.solicitationNumber && (
                      <span className="block break-words text-xs text-muted-foreground">
                        {item.solicitationNumber}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="align-top pl-4 text-sm text-muted-foreground whitespace-nowrap">
                    {item.assigneeName ?? <span className="text-muted-foreground">Unassigned</span>}
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline" className={cn('gap-1 text-xs', DEADLINE_BADGE_CLASSES[deadlineUrgency])}>
                      {deadlineLabel(deadlineUrgency, daysToDeadline)}
                    </Badge>
                  </TableCell>
                  <TableCell className="align-top text-sm text-foreground">
                    {formatCurrency(item.baseAndAllOptionsValue)}
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      {formatDaysWaiting(daysWaiting)}
                    </Badge>
                  </TableCell>
                  {canApprove && (
                    <TableCell className="text-right align-top">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isPending || !item.projectId}
                          onClick={() => item.projectId && onApprove(item.projectId, oppId)}
                        >
                          <Check className="h-3.5 w-3.5" />
                          Approve
                        </Button>
                        {onReject && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive hover:text-destructive"
                            disabled={isPending || !item.projectId}
                            onClick={() => item.projectId && onReject(item.projectId, oppId)}
                          >
                            <X className="h-3.5 w-3.5" />
                            Reject
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
