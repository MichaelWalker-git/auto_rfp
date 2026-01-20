'use client';

import React, { useMemo, useState } from 'react';
import type { OpportunityItem } from '@auto-rfp/shared';
import { Loader2, RefreshCw, Search } from 'lucide-react';

import { OpportunitiesListItem } from './OpportunitiesListItem';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useRouter, usePathname } from 'next/navigation';

import { useOpportunitiesList } from '@/lib/hooks/use-opportunities';

type Props = {
  projectId: string;
  limit?: number;
  className?: string;
  onOpen?: (item: OpportunityItem) => void;
};

const makeSearchHaystack = (it: OpportunityItem) =>
  [
    it.title,
    it.organizationName ?? '',
    it.organizationCode ?? '',
    it.naicsCode ?? '',
    it.pscCode ?? '',
    it.noticeId ?? '',
    it.solicitationNumber ?? '',
    it.type ?? '',
    it.setAside ?? '',
    it.setAsideCode ?? '',
    it.description ?? '',
    it.source ?? '',
    it.active ? 'active' : 'inactive',
  ]
    .join(' | ')
    .toLowerCase();

export function OpportunitiesList({ projectId, limit = 25, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const { items, isLoading, error, refresh, loadMore, canLoadMore, nextToken } = useOpportunitiesList({
    projectId,
    limit,
  });

  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => makeSearchHaystack(it).includes(needle));
  }, [items, q]);

  const showLoadingSkeleton = isLoading && items.length === 0;

  const handleOpen = (it: OpportunityItem) => {

    const id = it.oppId ?? it.id;
    const base = (pathname ?? '').replace(/\/$/, '');
    router.push(`${base}/${encodeURIComponent(id)}`);
  };

  return (
    <div className={cn('space-y-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, org, NAICS, solicitation, notice…"
            className="pl-9"
          />
        </div>

        <Button variant="outline" onClick={refresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Refresh
        </Button>
      </div>

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
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-sm text-muted-foreground">No opportunities found.</div>
      ) : (
        <div className="space-y-3">
          {filtered.map((it) => (
            <OpportunitiesListItem
              key={`${it.source}#${it.id}`}
              item={it}
              onOpen={() => handleOpen(it)}
            />
          ))}
        </div>
      )}

      <div className="flex justify-center pt-2">
        {canLoadMore ? (
          <Button onClick={loadMore} disabled={isLoading} variant="secondary">
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
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