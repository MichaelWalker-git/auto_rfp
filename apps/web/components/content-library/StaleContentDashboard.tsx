'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle,
  Ban,
  CheckCircle,
  Archive,
  RefreshCw,
  Clock,
  ShieldAlert,
  FileWarning,
  GitCompare,
  FileText,
  Tag,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useStaleContentReport, useReactivateContentItem, useBulkReviewContent } from '@/lib/hooks/use-stale-content';
import { FreshnessStatusBadge } from './FreshnessStatusBadge';
import type { StaleContentReportItem } from '@auto-rfp/core';

interface StaleContentDashboardProps {
  orgId: string;
  kbId: string;
}

const REASON_ICONS: Record<string, React.ElementType> = {
  NOT_USED: Clock,
  CERT_EXPIRED: ShieldAlert,
  SOURCE_UPDATED: FileWarning,
  CONFLICTING_ANSWER: GitCompare,
  MANUAL: Ban,
};

const REASON_LABELS: Record<string, string> = {
  NOT_USED: 'Not used recently',
  CERT_EXPIRED: 'Certification expired',
  SOURCE_UPDATED: 'Source document updated',
  CONFLICTING_ANSWER: 'Conflicts with newer entry',
  MANUAL: 'Manually flagged',
};

export function StaleContentDashboard({ orgId, kbId }: StaleContentDashboardProps) {
  const { summary, staleItems, warningItems, lastScanAt, isLoading, mutate } =
    useStaleContentReport(orgId, kbId);
  const { reactivate } = useReactivateContentItem(orgId, kbId);
  const { bulkReview, isBulkReviewing } = useBulkReviewContent(orgId, kbId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'stale' | 'warning'>('stale');

  const items = activeTab === 'stale' ? staleItems : warningItems;

  const handleToggleSelect = useCallback((itemId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((i: StaleContentReportItem) => i.item.id)));
    }
  }, [items, selectedIds.size]);

  const handleReactivate = useCallback(
    async (itemId: string) => {
      await reactivate(itemId);
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(itemId); return next; });
      mutate();
    },
    [reactivate, mutate],
  );

  const handleBulkAction = useCallback(
    async (action: 'REACTIVATE' | 'ARCHIVE') => {
      if (selectedIds.size === 0) return;
      await bulkReview({ itemIds: Array.from(selectedIds), action });
      setSelectedIds(new Set());
      mutate();
    },
    [selectedIds, bulkReview, mutate],
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-8 w-16 mb-2" />
                <Skeleton className="h-4 w-24" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <SummaryCard title="Active" count={summary?.active ?? 0} icon={CheckCircle} color="text-emerald-600" />
        <SummaryCard title="Warning" count={summary?.warning ?? 0} icon={AlertTriangle} color="text-amber-600" />
        <SummaryCard title="Stale" count={summary?.stale ?? 0} icon={Ban} color="text-red-600" />
        <SummaryCard title="Archived" count={summary?.archived ?? 0} icon={Archive} color="text-muted-foreground" />
      </div>

      {/* Last scan + Tab controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === 'stale' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setActiveTab('stale'); setSelectedIds(new Set()); }}
          >
            <Ban className="mr-1.5 h-3.5 w-3.5" />
            Stale ({staleItems.length})
          </Button>
          <Button
            variant={activeTab === 'warning' ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setActiveTab('warning'); setSelectedIds(new Set()); }}
          >
            <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
            Warnings ({warningItems.length})
          </Button>
          {lastScanAt && (
            <span className="text-xs text-muted-foreground ml-2">
              Last scan {formatDistanceToNow(new Date(lastScanAt), { addSuffix: true })}
            </span>
          )}
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <Button size="sm" variant="outline" onClick={() => handleBulkAction('REACTIVATE')} disabled={isBulkReviewing}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Reactivate
            </Button>
            <Button size="sm" variant="destructive" onClick={() => handleBulkAction('ARCHIVE')} disabled={isBulkReviewing}>
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              Archive
            </Button>
          </div>
        )}
      </div>

      {/* Select all toggle */}
      {items.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <Checkbox
            checked={selectedIds.size === items.length && items.length > 0}
            onCheckedChange={handleSelectAll}
            id="select-all"
          />
          <label htmlFor="select-all" className="text-xs text-muted-foreground cursor-pointer">
            Select all
          </label>
        </div>
      )}

      {/* Items List — card-based like KnowledgeBaseItemComponent */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/10 px-12 py-20">
          <div className="rounded-full bg-muted p-4 mb-6">
            <CheckCircle className="h-10 w-10 text-emerald-500" />
          </div>
          <h3 className="text-xl font-semibold mb-2">
            {activeTab === 'stale' ? 'No stale content' : 'No warnings'}
          </h3>
          <p className="text-muted-foreground text-center max-w-md">
            {activeTab === 'stale'
              ? 'All content library items and KB documents are current and safe to use.'
              : 'No items require review at this time.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((reportItem: StaleContentReportItem) => (
            <StaleItemCard
              key={reportItem.item.id}
              reportItem={reportItem}
              isSelected={selectedIds.has(reportItem.item.id)}
              onToggleSelect={handleToggleSelect}
              onReactivate={handleReactivate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function SummaryCard({ title, count, icon: Icon, color }: {
  title: string;
  count: number;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6 pb-4">
        <div className={`rounded-lg bg-muted p-2.5 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-2xl font-bold tabular-nums">{count}</p>
          <p className="text-xs text-muted-foreground">{title}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StaleItemCard({ reportItem, isSelected, onToggleSelect, onReactivate }: {
  reportItem: StaleContentReportItem;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onReactivate: (id: string) => void;
}) {
  const { item, reason, daysSinceLastUse } = reportItem;
  const ReasonIcon = REASON_ICONS[reason] ?? Clock;
  const isDocument = item.category === 'KB Documents';

  return (
    <Card className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60 transition-colors ${isSelected ? 'ring-2 ring-primary/20 bg-muted/40' : ''}`}>
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="mt-1">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(item.id)}
          />
        </div>

        <div className="mt-0.5">
          {isDocument ? (
            <FileText className="h-5 w-5 text-muted-foreground" />
          ) : (
            <Tag className="h-5 w-5 text-muted-foreground" />
          )}
        </div>

        <div className="space-y-1 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium truncate">{item.question}</span>
            <FreshnessStatusBadge
              status={item.freshnessStatus}
              reason={item.staleReason}
              staleSince={item.staleSince}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[10px]">{item.category}</Badge>

            <span className="flex items-center gap-1">
              <ReasonIcon className="h-3 w-3" />
              {REASON_LABELS[reason] ?? reason}
            </span>

            {daysSinceLastUse !== null && daysSinceLastUse !== Infinity && (
              <span>· {daysSinceLastUse} days unused</span>
            )}

            {item.updatedAt && (
              <span>
                · Updated {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0 pl-8 sm:pl-0">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onReactivate(item.id)}
          className="h-8"
        >
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Reactivate
        </Button>
      </div>
    </Card>
  );
}
