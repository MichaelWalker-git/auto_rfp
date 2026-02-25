'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  Trophy,
  Library,
  FileText,
  Pin,
  PinOff,
  EyeOff,
  RotateCcw,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

import {
  useOpportunityContext,
  useUpsertContextOverride,
  useRemoveContextOverride,
  useRefreshOpportunityContext,
  CONTEXT_SOURCE_LABELS,
  CONTEXT_SOURCE_COLORS,
  type ContextItem,
  type ContextItemSource,
} from '@/lib/hooks/use-opportunity-context';
import { useOpportunityContext as useOppCtx } from './opportunity-context';

// ─── Source icon map ──────────────────────────────────────────────────────────

const SOURCE_ICONS: Record<ContextItemSource, React.ReactNode> = {
  KNOWLEDGE_BASE: <BookOpen className="h-3.5 w-3.5" />,
  PAST_PERFORMANCE: <Trophy className="h-3.5 w-3.5" />,
  CONTENT_LIBRARY: <Library className="h-3.5 w-3.5" />,
  EXECUTIVE_BRIEF: <FileText className="h-3.5 w-3.5" />,
};

// ─── Single context item card ─────────────────────────────────────────────────

interface ContextItemCardProps {
  item: ContextItem;
  isPinned: boolean;
  isExcluded: boolean;
  onPin: (item: ContextItem) => void;
  onExclude: (item: ContextItem) => void;
  onRestore: (itemId: string) => void;
  isMutating: boolean;
}

function ContextItemCard({
  item,
  isPinned,
  isExcluded,
  onPin,
  onExclude,
  onRestore,
  isMutating,
}: ContextItemCardProps) {
  const [expanded, setExpanded] = useState(false);
  const scorePercent =
    item.relevanceScore !== undefined
      ? Math.round(item.relevanceScore * 100)
      : null;

  return (
    <div
      className={`rounded-lg border p-3 text-sm transition-colors ${
        isPinned
          ? 'border-indigo-300 bg-indigo-50'
          : isExcluded
          ? 'border-slate-200 bg-slate-50 opacity-60'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="secondary"
              className={`flex items-center gap-1 text-xs ${CONTEXT_SOURCE_COLORS[item.source]}`}
            >
              {SOURCE_ICONS[item.source]}
              {CONTEXT_SOURCE_LABELS[item.source]}
            </Badge>
            {scorePercent !== null && (
              <span className="text-xs text-slate-500">{scorePercent}% match</span>
            )}
            {isPinned && (
              <Badge variant="outline" className="border-indigo-300 text-indigo-700 text-xs">
                Pinned
              </Badge>
            )}
          </div>
          <p className="font-medium text-slate-800 leading-snug line-clamp-1">{item.title}</p>
        </div>

        {/* Action buttons */}
        <div className="flex shrink-0 items-center gap-1">
          {isPinned || isExcluded ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-slate-500 hover:text-slate-700"
              title="Restore to default"
              disabled={isMutating}
              onClick={() => onRestore(item.id)}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-500 hover:text-indigo-600"
                title="Pin — always include in generation"
                disabled={isMutating}
                onClick={() => onPin(item)}
              >
                <Pin className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-slate-500 hover:text-red-500"
                title="Exclude from generation"
                disabled={isMutating}
                onClick={() => onExclude(item)}
              >
                <EyeOff className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-slate-400"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Expandable preview */}
      {expanded && item.preview && (
        <p className="mt-2 text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-2">
          {item.preview}
        </p>
      )}
    </div>
  );
}

// ─── Section skeleton ─────────────────────────────────────────────────────────

function ContextSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

/**
 * OpportunityContextPanel
 *
 * Displays the auto-discovered relevant context items for an opportunity
 * (KB chunks, past-performance projects, content-library snippets) and
 * lets the user pin items (force-include) or exclude them from generation.
 */
export function OpportunityContextPanel() {
  const { projectId, oppId: opportunityId, orgId } = useOppCtx();

  const {
    suggestedItems,
    pinnedItems,
    excludedItems,
    excludedIds,
    lastRefreshedAt,
    isLoading,
    mutate,
  } = useOpportunityContext(projectId, opportunityId, orgId);

  const { trigger: upsertOverride, isMutating: isUpserting } =
    useUpsertContextOverride(projectId, opportunityId, orgId);

  const { trigger: removeOverride, isMutating: isRemoving } =
    useRemoveContextOverride(projectId, opportunityId, orgId);

  const { trigger: refresh, isMutating: isRefreshing } =
    useRefreshOpportunityContext(projectId, opportunityId, orgId);

  const isMutating = isUpserting || isRemoving;
  const excludedSet = new Set(excludedIds);
  const pinnedSet = new Set(pinnedItems.map((p) => p.id));
  const totalItems = suggestedItems.length + pinnedItems.length + excludedItems.length;

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handlePin = async (item: ContextItem) => {
    await upsertOverride({ projectId, opportunityId, orgId, item, action: 'PINNED' });
    await mutate();
  };

  const handleExclude = async (item: ContextItem) => {
    await upsertOverride({ projectId, opportunityId, orgId, item, action: 'EXCLUDED' });
    await mutate();
  };

  const handleRestore = async (itemId: string) => {
    await removeOverride({ projectId, opportunityId, orgId, itemId });
    await mutate();
  };

  const handleRefresh = async () => {
    await refresh();
    await mutate();
  };

  // ─── Group suggested items by source ────────────────────────────────────────

  const grouped = suggestedItems.reduce<Record<ContextItemSource, ContextItem[]>>(
    (acc, item) => {
      if (!acc[item.source]) acc[item.source] = [];
      acc[item.source].push(item);
      return acc;
    },
    {} as Record<ContextItemSource, ContextItem[]>,
  );

  const sourceOrder: ContextItemSource[] = [
    'KNOWLEDGE_BASE',
    'PAST_PERFORMANCE',
    'CONTENT_LIBRARY',
    'EXECUTIVE_BRIEF',
  ];

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Generation Context</CardTitle>
            {!isLoading && totalItems > 0 && (
              <Badge variant="secondary" className="text-xs">
                {totalItems} item{totalItems !== 1 ? 's' : ''}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-slate-500 hover:text-slate-700"
            disabled={isRefreshing || isLoading}
            onClick={handleRefresh}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            {isRefreshing ? 'Searching…' : 'Refresh'}
          </Button>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          Relevant KB, past performance, and content library items used when generating
          documents. Pin items to always include them, or exclude items to remove them.
        </p>
        {lastRefreshedAt && (
          <p className="text-xs text-slate-400">
            Last refreshed: {new Date(lastRefreshedAt).toLocaleString()}
          </p>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <ContextSkeleton />
        ) : totalItems === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center">
            <p className="text-sm text-slate-500">
              No relevant context found yet.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Upload a solicitation document, then click Refresh to search for relevant content.
            </p>
          </div>
        ) : (
          <>
            {/* ── Pinned items ── */}
            {pinnedItems.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <PinOff className="h-3.5 w-3.5 text-indigo-500" />
                  <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                    Pinned ({pinnedItems.length})
                  </span>
                </div>
                {pinnedItems.map((item) => (
                  <ContextItemCard
                    key={item.id}
                    item={item}
                    isPinned
                    isExcluded={false}
                    onPin={handlePin}
                    onExclude={handleExclude}
                    onRestore={handleRestore}
                    isMutating={isMutating}
                  />
                ))}
                <Separator />
              </div>
            )}

            {/* ── Suggested items grouped by source ── */}
            {sourceOrder.map((source) => {
              const items = grouped[source];
              if (!items?.length) return null;
              return (
                <div key={source} className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-400">{SOURCE_ICONS[source]}</span>
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                      {CONTEXT_SOURCE_LABELS[source]} ({items.length})
                    </span>
                  </div>
                  {items.map((item) => (
                    <ContextItemCard
                      key={item.id}
                      item={item}
                      isPinned={pinnedSet.has(item.id)}
                      isExcluded={excludedSet.has(item.id)}
                      onPin={handlePin}
                      onExclude={handleExclude}
                      onRestore={handleRestore}
                      isMutating={isMutating}
                    />
                  ))}
                </div>
              );
            })}

            {/* ── Excluded items ── */}
            {excludedItems.length > 0 && (
              <div className="space-y-2">
                <Separator />
                <div className="flex items-center gap-1.5">
                  <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                    Excluded ({excludedItems.length})
                  </span>
                </div>
                {excludedItems.map((item) => (
                  <ContextItemCard
                    key={item.id}
                    item={item}
                    isPinned={false}
                    isExcluded={true}
                    onPin={handlePin}
                    onExclude={handleExclude}
                    onRestore={handleRestore}
                    isMutating={isMutating}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
