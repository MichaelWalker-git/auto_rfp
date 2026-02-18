import { Skeleton } from '@/components/ui/skeleton';

interface PageLoadingSkeletonProps {
  /** Show header skeleton (title + action) */
  hasHeader?: boolean;
  /** Show description skeleton */
  hasDescription?: boolean;
  /** Number of content rows */
  rowCount?: number;
  /** Layout variant */
  variant?: 'list' | 'grid' | 'detail';
  /** Grid columns for 'grid' variant */
  gridCols?: number;
}

/**
 * Unified loading skeleton for all pages.
 * Provides consistent loading UI across the app.
 */
export function PageLoadingSkeleton({
  hasHeader = true,
  hasDescription = false,
  rowCount = 3,
  variant = 'list',
  gridCols = 3,
}: PageLoadingSkeletonProps) {
  return (
    <div className="container mx-auto p-12 space-y-6">
      {/* Header skeleton */}
      {hasHeader && (
        <div className="flex justify-between items-center">
          <div className="space-y-2">
            <Skeleton className="h-9 w-48" />
            {hasDescription && <Skeleton className="h-5 w-72" />}
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
      )}

      {/* Content skeleton */}
      {variant === 'grid' && (
        <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-${gridCols} gap-6`}>
          {Array.from({ length: rowCount }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      )}

      {variant === 'list' && (
        <div className="space-y-3">
          {Array.from({ length: rowCount }).map((_, i) => (
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
      )}

      {variant === 'detail' && (
        <div className="space-y-6">
          <Skeleton className="h-32 w-full rounded-lg" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}
