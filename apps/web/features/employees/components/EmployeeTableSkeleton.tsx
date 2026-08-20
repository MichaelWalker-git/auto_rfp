'use client';

import { Skeleton } from '@/components/ui/skeleton';

/** Loading state for the employee table (BR4.2) — skeletons, never spinners. */
export const EmployeeTableSkeleton = ({ rowCount = 6 }: { rowCount?: number }) => (
  <div className="space-y-3 rounded-md border p-4" data-testid="employee-table-skeleton">
    <div className="flex gap-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} className="h-5 flex-1" />
      ))}
    </div>
    {Array.from({ length: rowCount }).map((_, row) => (
      <div key={row} className="flex gap-4">
        {Array.from({ length: 5 }).map((_, col) => (
          <Skeleton key={col} className="h-8 flex-1" />
        ))}
      </div>
    ))}
  </div>
);
