'use client';

import React, { useMemo, useState } from 'react';
import type { OpportunityItem } from '@auto-rfp/shared';
import { ListX, Loader2, RefreshCw, Search } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { OpportunityListItem } from './OpportunityListItem';
import { useOpportunitiesList } from '@/lib/hooks/use-opportunities';

type Props = {
  projectId: string;
  limit?: number;
  onOpen?: (item: OpportunityItem) => void;
};

export default function OpportunitiesList({ projectId, limit = 25, onOpen }: Props) {
  const { items, isLoading, error, refresh, loadMore, canLoadMore } = useOpportunitiesList({
    projectId,
    limit,
  } as any);

  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;

    return items.filter((it: any) => {
      const hay = [
        it?.title,
        it?.name,
        it?.agency,
        it?.organization,
        it?.buyer,
        it?.department,
        it?.source,
        it?.status,
        it?.stage,
        it?.summary,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return hay.includes(q);
    });
  }, [items, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"/>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search opportunities…"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={refresh} className="gap-2">
            <RefreshCw className="h-4 w-4"/>
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {isLoading && items.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin"/>
          Loading opportunities…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border p-6 text-sm text-muted-foreground flex items-center gap-2">
          <ListX className="h-4 w-4"/>
          No opportunities found.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filtered.map((it: any) => (
            <OpportunityListItem
              key={(it?.PK && it?.SK ? `${it.PK}#${it.SK}` : it?.oppId ?? it?.id ?? JSON.stringify(it))}
              item={it}
              onOpen={onOpen}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-center pt-2">
        {canLoadMore ? (
          <Button variant="outline" onClick={loadMore}>
            Load more
          </Button>
        ) : (
          items.length > 0 && <div className="text-xs text-muted-foreground">End of list</div>
        )}
      </div>
    </div>
  );
}
