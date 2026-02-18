'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';

type PaginationControlsProps = {
  offset: number;
  limit: number;
  total: number;
  isLoading: boolean;
  onPage: (offset: number) => Promise<void>;
};

export function PaginationControls({
  offset,
  limit,
  total,
  isLoading,
  onPage,
}: PaginationControlsProps) {
  const canPrev = offset > 0;
  const canNext = offset + limit < total;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  if (total <= limit) {
    return null;
  }

  return (
    <div className="mt-4 flex items-center justify-between rounded-2xl border bg-muted/10 p-3">
      <Button
        variant="outline"
        disabled={!canPrev || isLoading}
        onClick={() => onPage(Math.max(0, offset - limit))}
      >
        Previous
      </Button>

      <div className="text-sm text-muted-foreground">
        Page <span className="text-foreground">{currentPage}</span> of{' '}
        <span className="text-foreground">{totalPages}</span>
      </div>

      <Button
        variant="outline"
        disabled={!canNext || isLoading}
        onClick={() => onPage(offset + limit)}
      >
        Next
      </Button>
    </div>
  );
}