'use client';

import React from 'react';
import type { OpportunityItem as OpportunityItemType } from '@auto-rfp/core';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { usePathname, useRouter } from 'next/navigation';

import { useOpportunitiesList } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';
import { OpportunityItemCard } from '@/components/opportunities/opportunity-item-card';

type Props = {
  projectId: string;
  limit?: number;
  className?: string;
  onOpen?: (item: OpportunityItemType) => void;
};

export function OpportunitiesList({ projectId, limit = 25, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const { currentOrganization } = useCurrentOrganization();

  const { items, isLoading, error, refresh, loadMore, canLoadMore, nextToken } = useOpportunitiesList({
    orgId: currentOrganization?.id || null,
    projectId,
    limit,
  });

  const showLoadingSkeleton = isLoading && items.length === 0;

  const handleOpen = (it: OpportunityItemType) => {

    const id = it.oppId ?? it.id;
    const base = (pathname ?? '').replace(/\/$/, '');
    router.push(`${base}/${encodeURIComponent(id)}`);
  };

  return (
    <div className={'space-y-2'}>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>
            {error.message}
            {error.status ? <span className="ml-2 opacity-80">(HTTP {error.status})</span> : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {showLoadingSkeleton ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full"/>
          <Skeleton className="h-24 w-full"/>
          <Skeleton className="h-24 w-full"/>
        </div>
      ) : items.length === 0 ? (
        <div className="text-sm text-muted-foreground">No opportunities found.</div>
      ) : (
        items.map((it) => (
          <OpportunityItemCard
            key={`${it.source}#${it.oppId}`}
            item={it}
            onOpen={() => handleOpen(it)}
            onUpdated={() => refresh()}
            onDeleted={() => refresh()}
          />
        ))
      )}

      <div className="flex justify-center pt-2">
        {canLoadMore ? (
          <Button onClick={loadMore} disabled={isLoading} variant="secondary">
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : null}
            Load more
          </Button>
        ) : items.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            End of list {nextToken ? '(more available)' : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}