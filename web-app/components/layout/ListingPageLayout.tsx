'use client';

import React, { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RotateCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ─── Types ───

export interface ListPageLayoutProps<T> {
  /** Page title */
  title: string;
  /** Subtitle/description below the title */
  description?: string;
  /** Actions/buttons to display in the header */
  headerActions?: ReactNode;
  /** Filters section above content */
  filters?: ReactNode;
  /** Container className */
  className?: string;
  /** Content area className */
  contentClassName?: string;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Number of skeleton rows to show */
  skeletonCount?: number;
  /** Custom skeleton renderer */
  renderSkeleton?: () => ReactNode;
  /** Empty state component */
  emptyState?: ReactNode;
  /** Whether data is empty */
  isEmpty?: boolean;
  /** Callback to reload data */
  onReload?: () => void | Promise<void>;
  /** Whether reload is in progress */
  isReloading?: boolean;
  /** Data items to render */
  data?: T[];
  /** Render function for each item — must return a keyed element */
  renderItem?: (item: T, index: number) => ReactNode;
  /** Key extractor for list items */
  getItemKey?: (item: T, index: number) => string | number;
  /** Children (alternative to data + renderItem) */
  children?: ReactNode;
}

// ─── Sub-components ───

function ListHeader({
  title,
  description,
  headerActions,
  onReload,
  isReloading,
}: {
  title: string;
  description?: string;
  headerActions?: ReactNode;
  onReload?: () => void | Promise<void>;
  isReloading: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div className="flex-1 min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        )}
      </div>
      <div className="flex gap-2 items-center shrink-0">
        {headerActions}
        {onReload && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onReload}
            disabled={isReloading}
            title="Reload data"
            className="h-8 w-8 p-0"
          >
            <RotateCw className={cn('h-4 w-4', isReloading && 'animate-spin')} />
          </Button>
        )}
      </div>
    </div>
  );
}

function ListSkeleton({ count = 3, renderSkeleton }: { count: number; renderSkeleton?: () => ReactNode }) {
  if (renderSkeleton) return <>{renderSkeleton()}</>;

  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-3 px-4 rounded-xl bg-muted/30">
          <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-8 rounded-md shrink-0" />
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───

export function ListingPageLayout<T>({
  title,
  description,
  headerActions,
  filters,
  className,
  contentClassName,
  isLoading = false,
  skeletonCount = 3,
  renderSkeleton,
  emptyState,
  isEmpty = false,
  onReload,
  isReloading = false,
  data = [],
  renderItem,
  getItemKey,
  children,
}: ListPageLayoutProps<T>) {
  const [isLocalReloading, setIsLocalReloading] = useState(false);

  const handleReload = useCallback(async () => {
    if (!onReload) return;
    try {
      setIsLocalReloading(true);
      await onReload();
    } finally {
      setIsLocalReloading(false);
    }
  }, [onReload]);

  const reloading = isReloading || isLocalReloading;

  // Determine content to render
  const hasData = !isEmpty && data.length > 0;
  const showEmpty = isEmpty || (!isLoading && data.length === 0 && !children);

  return (
    <div className={cn('space-y-6', className)}>
      <ListHeader
        title={title}
        description={description}
        headerActions={headerActions}
        onReload={onReload ? handleReload : undefined}
        isReloading={reloading}
      />

      {filters && (
        <Card>
          <CardContent className="p-4">{filters}</CardContent>
        </Card>
      )}

      {isLoading && (
        <ListSkeleton count={skeletonCount} renderSkeleton={renderSkeleton} />
      )}

      {!isLoading && showEmpty && emptyState}

      {!isLoading && hasData && renderItem && (
        <div className={cn('space-y-2', contentClassName)}>
          {data.map((item, index) => {
            const key = getItemKey ? getItemKey(item, index) : index;
            return <React.Fragment key={key}>{renderItem(item, index)}</React.Fragment>;
          })}
        </div>
      )}

      {!isLoading && children}
    </div>
  );
}