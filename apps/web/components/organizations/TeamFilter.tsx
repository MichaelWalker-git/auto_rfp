'use client';

import React from 'react';
import { SearchIcon } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface TeamFilterProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
}

export function TeamFilter({ searchQuery, onSearchChange }: TeamFilterProps) {
  return (
    <div className="relative">
      <Input
        type="text"
        placeholder="Search team members by name or email..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-full pl-9"
      />
      <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"/>
    </div>
  );
}
