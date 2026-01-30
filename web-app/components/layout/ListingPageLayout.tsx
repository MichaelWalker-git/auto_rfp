'use client';

import React, { ReactNode, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RotateCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export interface ListPageLayoutProps<T> {
  /** Page title */
  title: string;
  /** Subtitle/description below the title */
  description?: string;
  /** Actions/buttons to display in the header (e.g., Create, Filter buttons) */
  headerActions?: ReactNode;
  /** Filters section to display above content */
  filters?: ReactNode;
  /** Optional className for the container */
  className?: string;
  /** Optional className for the content area */
  contentClassName?: string;
  /** Show loading skeleton? */
  isLoading?: boolean;
  /** Empty state component to show when there's no content */
  emptyState?: ReactNode;
  /** Callback to reload/refresh data */
  onReload?: () => void | Promise<void>;
  /** Whether reload is in progress */
  isReloading?: boolean;
  isEmpty?: boolean;
  renderItem?: (item: T) => ReactNode;
  data?: T[];
  children?: ReactNode;
}

export function ListingPageLayout<T>({
                                       title,
                                       description,
                                       headerActions,
                                       filters,
                                       className,
                                       contentClassName,
                                       isLoading,
                                       emptyState,
                                       isEmpty = false,
                                       onReload,
                                       isReloading = false,
                                       renderItem = (_) => <></>,
                                       data = [],
                                       children
                                     }: ListPageLayoutProps<T>) {
  const [isLocalReloading, setIsLocalReloading] = useState(false);

  const handleReload = async () => {
    if (!onReload) return;

    try {
      setIsLocalReloading(true);
      await onReload();
    } finally {
      setIsLocalReloading(false);
    }
  };

  const reloading = isReloading || isLocalReloading;

  return (
    <div className={`space-y-6 ${className || ''}`}>
      {/* Header Section */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex-1 space-y-1">
          <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="flex gap-2 items-center justify-end">
          {headerActions && (
            <div className="flex gap-2 items-center">
              {headerActions}
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReload}
            disabled={reloading}
            title="Reload data"
            className="h-8 w-8 p-0"
          >
            <RotateCw className={`h-4 w-4 ${reloading ? 'animate-spin' : ''}`}/>
          </Button>
        </div>
      </div>

      {/* Filters Section */}
      {filters && (
        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="space-y-2">
              <div className="relative">
                {filters}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Content Section */}
      {
        isLoading && (
          <Card className={`${contentClassName || ''} border-none shadow-sm`}>
            <CardContent className="">
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-4 py-3 px-4 rounded-lg bg-muted/30">
                    <Skeleton className="h-10 w-10 rounded-md flex-shrink-0"/>
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-2/3"/>
                      <Skeleton className="h-3 w-1/3"/>
                    </div>
                    <Skeleton className="h-8 w-8 rounded-md flex-shrink-0"/>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      }
      {
        isEmpty && !isLoading && (emptyState)
      }
      {
        !isEmpty && !isLoading && data && data.length > 0 && (
          <Card className={`${contentClassName || ''} border-none shadow-sm`}>
            <CardContent className="">
              <div className="space-y-4">
                {data.map((item, index) => (
                  <div key={index}>
                    {renderItem(item)}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )
      }
      {
        children && children
      }
    </div>
  );
}