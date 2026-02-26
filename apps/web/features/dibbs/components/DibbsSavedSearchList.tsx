'use client';

import type { SavedSearch } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Trash2, ToggleLeft, ToggleRight } from 'lucide-react';

interface DibbsSavedSearchListProps {
  savedSearches: SavedSearch[];
  isLoading: boolean;
  onDelete: (savedSearchId: string) => void;
  onToggle: (savedSearchId: string, isEnabled: boolean) => void;
  deletingId: string | null;
}

export const DibbsSavedSearchList = ({
  savedSearches,
  isLoading,
  onDelete,
  onToggle,
  deletingId,
}: DibbsSavedSearchListProps) => {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!savedSearches.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No saved searches yet. Create one to get started.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {savedSearches.map((s) => (
        <div
          key={s.savedSearchId}
          className="flex items-center justify-between rounded-md border p-4 hover:bg-muted/30 transition-colors"
        >
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm truncate">{s.name}</span>
              <Badge variant={s.isEnabled ? 'default' : 'secondary'} className="shrink-0">
                {s.isEnabled ? 'Active' : 'Paused'}
              </Badge>
              <Badge variant="outline" className="shrink-0 text-xs">
                {s.frequency}
              </Badge>
              {s.autoImport && (
                <Badge variant="outline" className="shrink-0 text-xs text-emerald-600 border-emerald-300">
                  Auto-import
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Last run: {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : 'Never'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 ml-4">
            <Button
              variant="ghost"
              size="icon"
              title={s.isEnabled ? 'Pause search' : 'Enable search'}
              onClick={() => onToggle(s.savedSearchId, !s.isEnabled)}
            >
              {s.isEnabled
                ? <ToggleRight className="h-4 w-4 text-emerald-600" />
                : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Delete saved search"
              disabled={deletingId === s.savedSearchId}
              onClick={() => onDelete(s.savedSearchId)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};
