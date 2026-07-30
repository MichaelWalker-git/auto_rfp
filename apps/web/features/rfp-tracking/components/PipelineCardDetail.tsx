'use client';

import Link from 'next/link';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CalendarClock, User, Clock, ExternalLink, ArrowUpRight } from 'lucide-react';
import {
  RFP_STAGE_LABELS,
  RFP_STAGE_COLORS,
  OPPORTUNITY_APPROVAL_LABELS,
  OPPORTUNITY_APPROVAL_COLORS,
} from '@auto-rfp/core';
import type { RfpPipelineItem } from '@auto-rfp/core';
import { resolveStage, resolveApprovalStatus } from '../lib/derive-board';
import { buildTransitionTimeline } from '../lib/derive-timeline';
import { formatCurrency, formatDeadline, formatRelativeTime } from '../lib/format';

interface PipelineCardDetailProps {
  item: RfpPipelineItem;
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Absolute, locale date-time for a transition timestamp; '' when unparseable. */
const formatDateTime = (iso: string): string => {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Date(ts).toLocaleString();
};

/**
 * The card detail panel — a right-side Sheet showing the RFP summary, its full
 * merged stage/approval transition history (most recent first), and outbound
 * links to the full opportunity and the source Linear issue. Presentation-only:
 * the timeline is derived by the pure `buildTransitionTimeline` helper.
 */
export function PipelineCardDetail({ item, orgId, open, onOpenChange }: PipelineCardDetailProps) {
  const stage = resolveStage(item);
  const approvalStatus = resolveApprovalStatus(item);
  const timeline = buildTransitionTimeline(item);

  const oppId = item.oppId ?? item.id;
  const detailHref =
    item.projectId && oppId
      ? `/organizations/${orgId}/projects/${item.projectId}/opportunities/${oppId}`
      : null;

  const nowIso = new Date().toISOString();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-base leading-snug">{item.title}</SheetTitle>
          {/* Always render a description so the dialog is properly labelled; the
              solicitation number is the meaningful one when present. */}
          <SheetDescription className={item.solicitationNumber ? undefined : 'sr-only'}>
            {item.solicitationNumber ?? 'RFP transition history and links.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 p-4">
          {/* Summary block */}
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={cn('text-xs', RFP_STAGE_COLORS[stage])}>
                {RFP_STAGE_LABELS[stage]}
              </Badge>
              <Badge
                variant="outline"
                className={cn('text-xs', OPPORTUNITY_APPROVAL_COLORS[approvalStatus])}
              >
                {OPPORTUNITY_APPROVAL_LABELS[approvalStatus]}
              </Badge>
            </div>

            <dl className="grid grid-cols-1 gap-1.5 text-xs text-slate-600">
              <div className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-slate-400" />
                <dt className="sr-only">Owner</dt>
                <dd>{item.assigneeName ?? 'Unassigned'}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                <dt className="sr-only">Response deadline</dt>
                <dd>{formatDeadline(item.responseDeadlineIso)}</dd>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3.5 text-center text-slate-400">$</span>
                <dt className="sr-only">Value</dt>
                <dd className="font-medium text-slate-700">
                  {formatCurrency(item.baseAndAllOptionsValue)}
                </dd>
              </div>
            </dl>
          </section>

          <Separator />

          {/* Transition history timeline */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
              <Clock className="h-3.5 w-3.5 text-slate-400" />
              Transition history
            </h3>

            {timeline.length === 0 ? (
              <p className="text-xs text-slate-400">No recorded transitions yet.</p>
            ) : (
              <ol className="space-y-3">
                {timeline.map((entry, index) => (
                  <li
                    key={`${entry.kind}-${entry.changedAt}-${index}`}
                    className="border-l-2 border-slate-200 pl-3"
                  >
                    <div className="flex items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={cn(
                          'text-[10px] uppercase tracking-wide',
                          entry.kind === 'approval'
                            ? 'border-indigo-200 bg-indigo-50 text-indigo-600'
                            : 'border-slate-200 bg-slate-50 text-slate-500',
                        )}
                      >
                        {entry.kind}
                      </Badge>
                      <p className="text-xs font-medium text-slate-700">{entry.label}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {formatDateTime(entry.changedAt)}
                      {(() => {
                        const rel = formatRelativeTime(entry.changedAt, nowIso);
                        return rel ? ` · ${rel}` : '';
                      })()}
                      {` · ${entry.actor}`}
                    </p>
                    {entry.reason && (
                      <p className="mt-1 text-xs italic text-slate-500">“{entry.reason}”</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          <Separator />

          {/* Links section */}
          <section className="space-y-2">
            <h3 className="text-sm font-medium text-slate-800">Links</h3>

            {detailHref && (
              <Link
                href={detailHref}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full justify-start')}
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                View full opportunity
              </Link>
            )}

            {item.sourceUrl && (
              <a
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'w-full justify-start')}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Open in Linear
              </a>
            )}

            {/*
             * CRM Sheet row and Drive PDF links belong here once those
             * integrations exist. There is no CRM/Drive linkage on the item
             * yet, so we intentionally render nothing rather than fabricate
             * dead links. Add them alongside the "Open in Linear" link above.
             */}

            {!detailHref && !item.sourceUrl && (
              <p className="text-xs text-slate-400">No external links available.</p>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
