'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Bookmark, Search, Sparkles } from 'lucide-react';

interface SavedSearchEmptyStateProps {
  /** URL to navigate to the search page */
  searchUrl?: string;
  /** Callback for creating a new search */
  onCreate?: () => void;
}

export const SavedSearchEmptyState = ({ searchUrl, onCreate }: SavedSearchEmptyStateProps) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 px-6 text-center bg-muted/5">
    {/* ── Decorative icon cluster ──────────────────────────────────── */}
    <div className="relative mb-6">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Bookmark className="h-8 w-8 text-primary" />
      </div>
      <div className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-card border shadow-sm">
        <Sparkles className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" />
      </div>
    </div>

    <h3 className="text-lg font-semibold text-foreground">No saved searches yet</h3>
    <p className="mt-2 max-w-sm text-sm text-muted-foreground leading-relaxed">
      Save your search filters to automatically monitor new opportunities on a schedule.
      Get notified when matching results appear.
    </p>

    <div className="mt-6 flex items-center gap-3">
      {searchUrl && (
        <Button asChild>
          <Link href={searchUrl}>
            <Search className="mr-2 h-4 w-4" />
            Start searching
          </Link>
        </Button>
      )}
      {onCreate && (
        <Button variant={searchUrl ? 'outline' : 'default'} onClick={onCreate}>
          <Search className="mr-2 h-4 w-4" />
          Create search
        </Button>
      )}
    </div>
  </div>
);
