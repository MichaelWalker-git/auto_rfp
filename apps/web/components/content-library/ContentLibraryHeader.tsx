'use client';

import { Plus, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSearch } from '@/components/layout/page-search';
import Link from 'next/link';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ApprovalStatus } from '@/lib/hooks/use-content-library';

interface ContentLibraryHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCategory: string | undefined;
  onCategoryChange: (category: string | undefined) => void;
  selectedStatus: ApprovalStatus | undefined;
  onStatusChange: (status: ApprovalStatus | undefined) => void;
  categories: Array<{ name: string; count: number }>;
  onCreateClick: () => void;
  total: number;
  orgId?: string;
  kbId?: string;
}

/**
 * Header actions row for ContentLibrary — matches the pattern used by
 * KnowledgeBaseItemComponent and other listing pages.
 * Search + filter buttons are rendered inline at the same size as other page header actions.
 */
export function ContentLibraryHeader({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onCategoryChange,
  selectedStatus,
  onStatusChange,
  categories,
  onCreateClick,
  total,
  orgId,
  kbId,
}: ContentLibraryHeaderProps) {
  const statusOptions: Array<{ value: ApprovalStatus; label: string }> = [
    { value: 'DRAFT', label: 'Draft' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'DEPRECATED', label: 'Deprecated' },
  ];

  const hasActiveFilters = selectedCategory || selectedStatus;

  return (
    <div className="space-y-4">
      {/* Top row: Title + Actions — matching ListingPageLayout pattern */}
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} {total === 1 ? 'item' : 'items'} in your library
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PageSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search questions or answers..."
          />
          {orgId && kbId && (
            <Button variant="outline" asChild>
              <Link href={`/organizations/${orgId}/knowledge-base/${kbId}/stale-report`}>
                <ShieldAlert className="h-4 w-4 mr-2" />
                Stale Report
              </Link>
            </Button>
          )}
          <Button onClick={onCreateClick}>
            <Plus className="h-4 w-4 mr-2" />
            Add Content
          </Button>
        </div>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2">
        <Select
          value={selectedCategory || 'all'}
          onValueChange={(value) =>
            onCategoryChange(value === 'all' ? undefined : value)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.name} value={cat.name}>
                {cat.name} ({cat.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={selectedStatus || 'all'}
          onValueChange={(value) =>
            onStatusChange(value === 'all' ? undefined : (value as ApprovalStatus))
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {statusOptions.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onCategoryChange(undefined);
              onStatusChange(undefined);
            }}
          >
            Clear filters
            <Badge variant="secondary" className="ml-1.5">
              {(selectedCategory ? 1 : 0) + (selectedStatus ? 1 : 0)}
            </Badge>
          </Button>
        )}
      </div>
    </div>
  );
}
