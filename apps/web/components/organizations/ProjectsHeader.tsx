'use client';

import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PlusIcon, SearchIcon } from 'lucide-react';

interface ProjectsHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onNewProject: () => void;
}

export function ProjectsHeader({ 
  searchQuery, 
  onSearchChange, 
  onNewProject 
}: ProjectsHeaderProps) {
  return (
    <div className="flex flex-col md:flex-row justify-between gap-4">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <div className="flex gap-2">
        <div className="relative flex-1 md:w-64">
          <Input
            type="text"
            placeholder="Search for a project"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-9"
          />
          <SearchIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>
        <Button onClick={onNewProject}>
          <PlusIcon className="mr-2 h-4 w-4" />
          New project
        </Button>
      </div>
    </div>
  );
} 