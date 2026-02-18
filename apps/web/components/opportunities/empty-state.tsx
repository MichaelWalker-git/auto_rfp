'use client';

import * as React from 'react';
import { Search } from 'lucide-react';

type EmptyStateProps = {
  message?: string;
  description?: string;
};

export function EmptyState({
  message = 'No matches',
  description = 'Try expanding your date range or adjusting NAICS/keywords.',
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-muted/10 py-14 text-center">
      <Search className="h-10 w-10 text-muted-foreground/50" />
      <p className="mt-3 text-sm font-medium">{message}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}