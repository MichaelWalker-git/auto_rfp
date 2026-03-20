import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

/**
 * Route-level loading skeleton for the Edit Project page.
 * Mirrors the exact layout: header (back + icon + title) → card (name + description fields) → action bar.
 */
export default function EditProjectLoading() {
  return (
    <div className="container max-w-3xl mx-auto py-6 px-4">
      {/* Header skeleton */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      </div>

      {/* Card skeleton */}
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-64 mt-1" />
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Name field */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3.5 w-72" />
          </div>
          {/* Description field */}
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-[104px] w-full" />
            <Skeleton className="h-3.5 w-80" />
          </div>
        </CardContent>
      </Card>

      {/* Actions skeleton */}
      <Separator className="mt-6" />
      <div className="flex items-center justify-between mt-6">
        <Skeleton className="h-10 w-20" />
        <Skeleton className="h-10 w-32" />
      </div>
    </div>
  );
}
