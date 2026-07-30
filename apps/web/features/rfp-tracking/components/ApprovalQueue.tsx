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
  /** @deprecated Approval is open to every org member; retained for compatibility. */
  canApproveInitial?: boolean;
  /** @deprecated Approval is open to every org member; retained for compatibility. */
  canApproveFinal?: boolean;
}

/**
 * Two approval queues stacked: gate 1 (Initial Approval) and gate 2
 * (Pre-Submission Approval). Approve/Reject render for every org member — the
 * backend enforces authorization on the decision endpoint.
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
      <p className="rounded-lg border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">
        Nothing is waiting for approval.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      {error && <p className="text-sm text-red-600">{error}</p>}

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
      <h3 className="text-sm font-semibold text-slate-700">
        {title}
        <Badge variant="outline" className="ml-2 text-xs text-slate-500">
          {queue.length}
        </Badge>
      </h3>

      {queue.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">
          {emptyLabel}
        </p>
      ) : (
        <Table>
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
                  <TableCell className="max-w-xs">
                    {detailHref ? (
                      <Link
                        href={detailHref}
                        title={item.title}
                        className="block max-w-xs truncate font-medium text-indigo-600 hover:underline"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <span className="block max-w-xs truncate font-medium" title={item.title}>
                        {item.title}
                      </span>
                    )}
                    {item.solicitationNumber && (
                      <span className="block max-w-xs truncate text-xs text-slate-400">
                        {item.solicitationNumber}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {item.assigneeName ?? <span className="text-slate-400">Unassigned</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={cn('gap-1 text-xs', DEADLINE_BADGE_CLASSES[deadlineUrgency])}>
                      {deadlineLabel(deadlineUrgency, daysToDeadline)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {formatCurrency(item.baseAndAllOptionsValue)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs text-slate-600">
                      {formatDaysWaiting(daysWaiting)}
                    </Badge>
                  </TableCell>
                  {canApprove && (
                    <TableCell className="text-right">
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
                            className="text-red-600 hover:text-red-700"
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
