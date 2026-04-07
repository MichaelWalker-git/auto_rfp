'use client';

import React, { useState, useMemo } from 'react';
import type { OpportunityItem as OpportunityItemType } from '@auto-rfp/core';
import { Loader2, Search, ArrowUpDown, LayoutGrid, Columns2, Square, User } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePathname, useRouter } from 'next/navigation';

import { useOpportunitiesList } from '@/lib/hooks/use-opportunities';
import { useFavoriteOpportunities } from '@/lib/hooks/use-favorite-opportunities';
import { useGridView, getGridClasses } from '@/lib/hooks/use-grid-view';
import { useCurrentOrganization } from '@/context/organization-context';
import { useAuth } from '@/components/AuthProvider';
import { OpportunityItemCard } from '@/components/opportunities/opportunity-item-card';
import { cn } from '@/lib/utils';

type SortOption = 'dateImported-desc' | 'dateImported-asc' | 'title-asc' | 'title-desc' | 'responseDeadline-asc' | 'responseDeadline-desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'dateImported-desc', label: 'Date Imported (Newest)' },
  { value: 'dateImported-asc', label: 'Date Imported (Oldest)' },
  { value: 'title-asc', label: 'Title (A-Z)' },
  { value: 'title-desc', label: 'Title (Z-A)' },
  { value: 'responseDeadline-asc', label: 'Response Deadline (Soonest)' },
  { value: 'responseDeadline-desc', label: 'Response Deadline (Latest)' },
];

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
  const { userSub } = useAuth();
  const { isFavorite, toggleFavorite } = useFavoriteOpportunities();
  const { columns, setColumns } = useGridView();

  // Search, sort, and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('dateImported-desc');
  const [showOnlyMine, setShowOnlyMine] = useState(false);

  const { items, isLoading, error, refresh, loadMore, canLoadMore, nextToken } = useOpportunitiesList({
    orgId: currentOrganization?.id || null,
    projectId,
    limit,
  });

  const showLoadingSkeleton = isLoading && items.length === 0;

  // Filter and sort items (favorites first, then by sort option)
  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    // Filter by "assigned to me"
    if (showOnlyMine && userSub) {
      result = result.filter((it) => {
        const assigneeId = it.assigneeId ?? undefined;
        return assigneeId === userSub;
      });
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter((it) => {
        const title = (it.title ?? '').toLowerCase();
        const solNum = (it.solicitationNumber ?? '').toLowerCase();
        const orgName = (it.organizationName ?? '').toLowerCase();
        const description = (it.description ?? '').toLowerCase();
        return (
          title.includes(query) ||
          solNum.includes(query) ||
          orgName.includes(query) ||
          description.includes(query)
        );
      });
    }

    // Sort: favorites first, then by selected option
    result.sort((a, b) => {
      const aId = a.oppId ?? a.id;
      const bId = b.oppId ?? b.id;
      const aIsFav = isFavorite(aId);
      const bIsFav = isFavorite(bId);

      // Favorites always come first
      if (aIsFav && !bIsFav) return -1;
      if (!aIsFav && bIsFav) return 1;

      // If both have the same favorite status, sort by selected option
      switch (sortOption) {
        case 'dateImported-desc': {
          // Use createdAt (when imported) as the primary sort field
          const aDate = a.createdAt ?? a.postedDateIso ?? '';
          const bDate = b.createdAt ?? b.postedDateIso ?? '';
          return bDate.localeCompare(aDate);
        }
        case 'dateImported-asc': {
          const aDate = a.createdAt ?? a.postedDateIso ?? '';
          const bDate = b.createdAt ?? b.postedDateIso ?? '';
          return aDate.localeCompare(bDate);
        }
        case 'title-asc': {
          const aTitle = (a.title ?? '').toLowerCase();
          const bTitle = (b.title ?? '').toLowerCase();
          return aTitle.localeCompare(bTitle);
        }
        case 'title-desc': {
          const aTitle = (a.title ?? '').toLowerCase();
          const bTitle = (b.title ?? '').toLowerCase();
          return bTitle.localeCompare(aTitle);
        }
        case 'responseDeadline-asc': {
          const aDeadline = a.responseDeadlineIso ?? '';
          const bDeadline = b.responseDeadlineIso ?? '';
          // Put items without deadlines at the end
          if (!aDeadline && bDeadline) return 1;
          if (aDeadline && !bDeadline) return -1;
          return aDeadline.localeCompare(bDeadline);
        }
        case 'responseDeadline-desc': {
          const aDeadline = a.responseDeadlineIso ?? '';
          const bDeadline = b.responseDeadlineIso ?? '';
          // Put items without deadlines at the end
          if (!aDeadline && bDeadline) return 1;
          if (aDeadline && !bDeadline) return -1;
          return bDeadline.localeCompare(aDeadline);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [items, searchQuery, sortOption, isFavorite, showOnlyMine, userSub]);

  const handleOpen = (it: OpportunityItemType) => {
    const id = it.oppId ?? it.id;
    const base = (pathname ?? '').replace(/\/$/, '');
    router.push(`${base}/${encodeURIComponent(id)}`);
  };

  return (
    <div className={'space-y-4'}>
      {/* Search, Sort, and View Controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by title, solicitation #, or agency..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          {/* My Opportunities filter */}
          <Button
            variant={showOnlyMine ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowOnlyMine(!showOnlyMine)}
            className="h-9 gap-1.5"
            title={showOnlyMine ? 'Show all opportunities' : 'Show only my opportunities'}
          >
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">My Opportunities</span>
          </Button>

          <Select value={sortOption} onValueChange={(value) => setSortOption(value as SortOption)}>
            <SelectTrigger className="w-full sm:w-[220px]">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Sort by..." />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {/* Grid view toggle */}
          <div className="flex items-center border rounded-md bg-background">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setColumns(4)}
              className={cn(
                'h-9 px-2.5 rounded-r-none border-r',
                columns === 4 ? 'bg-muted' : ''
              )}
              title="4 columns"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setColumns(2)}
              className={cn(
                'h-9 px-2.5 rounded-none border-r',
                columns === 2 ? 'bg-muted' : ''
              )}
              title="2 columns"
            >
              <Columns2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setColumns(1)}
              className={cn(
                'h-9 px-2.5 rounded-l-none',
                columns === 1 ? 'bg-muted' : ''
              )}
              title="1 column"
            >
              <Square className="h-4 w-4" />
            </Button>
          </div>
        </div>
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
        <div className={getGridClasses(columns)}>
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl"/>
          ))}
        </div>
      ) : filteredAndSortedItems.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {searchQuery.trim() ? `No opportunities matching "${searchQuery}"` : 'No opportunities found.'}
        </div>
      ) : (
        <div className={getGridClasses(columns)}>
          {filteredAndSortedItems.map((it) => {
            const oppId = it.oppId ?? it.id;
            return (
              <OpportunityItemCard
                key={`${it.source}#${oppId}`}
                item={it}
                onOpen={() => handleOpen(it)}
                onUpdated={() => refresh()}
                onDeleted={() => refresh()}
                showDescription={false}
                isFavorite={isFavorite(oppId)}
                onToggleFavorite={toggleFavorite}
                gridColumns={columns}
              />
            );
          })}
        </div>
      )}

      {/* Results count when filtering */}
      {searchQuery.trim() && filteredAndSortedItems.length > 0 && (
        <div className="text-xs text-muted-foreground text-center">
          Showing {filteredAndSortedItems.length} of {items.length} opportunities
        </div>
      )}

      <div className="flex justify-center pt-2">
        {canLoadMore ? (
          <Button onClick={loadMore} disabled={isLoading} variant="secondary">
            {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin"/> : null}
            Load more
          </Button>
        ) : items.length > 0 && !searchQuery.trim() ? (
          <div className="text-xs text-muted-foreground">
            End of list {nextToken ? '(more available)' : ''}
          </div>
        ) : null}
      </div>
    </div>
  );
}
