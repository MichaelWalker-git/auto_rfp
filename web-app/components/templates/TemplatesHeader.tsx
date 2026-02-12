'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search } from 'lucide-react';

interface TemplatesHeaderProps {
  total: number;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCreateClick: () => void;
}

export function TemplatesHeader({
  total,
  searchQuery,
  onSearchChange,
  onCreateClick,
}: TemplatesHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Templates</h1>
        <p className="text-muted-foreground text-sm">
          {total} template{total !== 1 ? 's' : ''} available
        </p>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-9 w-64"
          />
        </div>
        <Button onClick={onCreateClick}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>
    </div>
  );
}