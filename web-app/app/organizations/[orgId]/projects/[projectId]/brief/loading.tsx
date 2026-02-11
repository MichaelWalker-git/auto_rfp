import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2 } from 'lucide-react';

export default function BriefLoading() {
  return (
    <div className="space-y-6 p-6 w-full">
      {/* Loading indicator */}
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm font-medium">Loading executive brief...</span>
      </div>

      {/* Opportunity selector skeleton */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-full max-w-md" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      </div>

      {/* Header with title and action buttons */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      {/* Tabs skeleton */}
      <div className="flex gap-1 p-1">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-10 rounded-md" />
        ))}
      </div>

      {/* Content area skeleton - mimics the Overview tab */}
      <div className="space-y-6 mt-6">
        {/* Decision card skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </CardContent>
        </Card>

        {/* Scoring grid skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Summary card skeleton */}
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-36" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}