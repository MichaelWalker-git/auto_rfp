'use client';

import React, { useMemo } from 'react';
import type { SavedSearch } from '@auto-rfp/core';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDeleteDialog, useConfirmDelete } from '@/components/ui/confirm-delete-dialog';

import { Bookmark, Plus } from 'lucide-react';

import {
  useDeleteSavedSearch,
  useListSavedSearches,
  useUpdateSavedSearch,
} from '@/lib/hooks/use-saved-search';

import { SavedSearchCard } from '@/components/samgov/SavedSearchCard';
import { SavedSearchEmptyState } from '@/components/samgov/SavedSearchEmptyState';
import { SavedSearchGridSkeleton } from '@/components/samgov/SavedSearchGridSkeleton';

// ─── Component ────────────────────────────────────────────────────────────────

interface SavedSearchListProps {
  orgId: string;
  onCreate?: () => void;
  onOpen?: (savedSearch: SavedSearch) => void;
}

export const SavedSearchList = ({ orgId, onCreate, onOpen }: SavedSearchListProps) => {
  const { toast } = useToast();

  const { items, isLoading, error, refresh } = useListSavedSearches({ orgId });
  const { trigger: deleteTrigger, isMutating: isDeleting } = useDeleteSavedSearch();
  const { trigger: updateTrigger, isMutating: isUpdating } = useUpdateSavedSearch();
  const { requestDelete, pendingItem, dialogProps } = useConfirmDelete<SavedSearch>();

  const isBusy = isDeleting || isUpdating;

  // Sort: enabled first, then by most recently updated
  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
        const ta = new Date(a.updatedAt ?? 0).getTime();
        const tb = new Date(b.updatedAt ?? 0).getTime();
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      }),
    [items],
  );

  const handleRun = (s: SavedSearch) => {
    onOpen?.(s);
  };

  const handleDelete = async () => {
    if (!pendingItem) return;
    try {
      await deleteTrigger({ orgId, savedSearchId: pendingItem.savedSearchId });
      await refresh();
      toast({ title: 'Deleted', description: `"${pendingItem.name}" was removed.` });
    } catch (e: unknown) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const handleToggleEnabled = async (s: SavedSearch) => {
    const next = !s.isEnabled;
    try {
      await updateTrigger({
        orgId,
        savedSearchId: s.savedSearchId,
        patch: { isEnabled: next },
      } as Parameters<typeof updateTrigger>[0]);
      await refresh();
      toast({
        title: next ? 'Enabled' : 'Paused',
        description: `"${s.name}" is now ${next ? 'active' : 'paused'}.`,
      });
    } catch (e: unknown) {
      toast({
        title: 'Update failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Bookmark className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Saved Searches</h2>
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? 'Loading…'
                : sorted.length === 0
                  ? 'No searches configured'
                  : `${sorted.length} search${sorted.length !== 1 ? 'es' : ''}`}
            </p>
          </div>
        </div>

        {onCreate && (
          <Button onClick={onCreate} disabled={isBusy} size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            New search
          </Button>
        )}
      </div>

      {/* ── Error banner ─────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Failed to load saved searches</p>
          <p className="mt-1 text-muted-foreground">{String((error as Error)?.message ?? error)}</p>
        </div>
      )}

      {/* ── Content ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <SavedSearchGridSkeleton count={3} />
      ) : sorted.length === 0 ? (
        <SavedSearchEmptyState onCreate={onCreate} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((s) => (
            <SavedSearchCard
              key={s.savedSearchId}
              savedSearch={s}
              onRun={handleRun}
              onDelete={requestDelete}
              onToggleEnabled={handleToggleEnabled}
              disabled={isBusy}
            />
          ))}
        </div>
      )}

      {/* ── Delete confirmation ──────────────────────────────────────── */}
      <ConfirmDeleteDialog
        {...dialogProps}
        itemName={pendingItem?.name}
        itemType="saved search"
        onConfirm={handleDelete}
      />
    </div>
  );
};
