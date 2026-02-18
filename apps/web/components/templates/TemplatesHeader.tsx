'use client';

import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { PageSearch } from '@/components/layout/page-search';

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
    <PageHeader
      title="Templates"
      description={`${total} template${total !== 1 ? 's' : ''} available`}
      actions={
        <>
          <PageSearch
            value={searchQuery}
            onChange={onSearchChange}
            placeholder="Search templates..."
            widthClass="w-64"
          />
          <Button onClick={onCreateClick}>
            <Plus className="h-4 w-4 mr-2" />
            New Template
          </Button>
        </>
      }
    />
  );
}
