'use client';

import React from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

interface SavedSearchGridSkeletonProps {
  count?: number;
}

export const SavedSearchGridSkeleton = ({ count = 6 }: SavedSearchGridSkeletonProps) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: count }).map((_, i) => (
      <Card key={i} className="overflow-hidden flex flex-col h-full border">
        {/* Header — matches BaseCard CardHeader */}
        <CardHeader className="pb-2 pt-4 px-4 flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </div>
        </CardHeader>

        {/* Footer — matches BaseCard footer */}
        <div className="px-4 py-2 border-t border-border/50 bg-muted/30 flex-shrink-0 mt-auto">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-14 rounded-md" />
            <Skeleton className="h-5 w-12 rounded-md" />
            <Skeleton className="h-3.5 w-16 rounded ml-auto" />
          </div>
        </div>
      </Card>
    ))}
  </div>
);
