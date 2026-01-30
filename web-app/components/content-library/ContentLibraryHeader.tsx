'use client';

import { SearchIcon, Plus, Filter } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
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
}

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
}: ContentLibraryHeaderProps) {
  const statusOptions: Array<{ value: ApprovalStatus; label: string; color: string }> = [
    { value: 'DRAFT', label: 'Draft', color: 'bg-yellow-100 text-yellow-800' },
    { value: 'APPROVED', label: 'Approved', color: 'bg-green-100 text-green-800' },
    { value: 'DEPRECATED', label: 'Deprecated', color: 'bg-gray-100 text-gray-800' },
  ];

  const activeFiltersCount =
    (selectedCategory ? 1 : 0) + (selectedStatus ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Content Library</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} {total === 1 ? 'item' : 'items'} in your library
          </p>
        </div>
        <Button onClick={onCreateClick}>
          <Plus className="h-4 w-4 mr-2" />
          Add Content
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Input
            type="text"
            placeholder="Search questions or answers..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9"
          />
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>

        <Select
          value={selectedCategory || 'all'}
          onValueChange={(value) =>
            onCategoryChange(value === 'all' ? undefined : value)
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
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
            <SelectValue placeholder="Status" />
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

        {activeFiltersCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onCategoryChange(undefined);
              onStatusChange(undefined);
            }}
          >
            <Filter className="h-4 w-4 mr-1" />
            Clear filters
            <Badge variant="secondary" className="ml-2">
              {activeFiltersCount}
            </Badge>
          </Button>
        )}
      </div>
    </div>
  );
}
