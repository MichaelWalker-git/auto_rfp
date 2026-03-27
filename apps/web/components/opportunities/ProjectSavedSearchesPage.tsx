'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SavedSearch } from '@auto-rfp/core';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { ConfirmDeleteDialog, useConfirmDelete } from '@/components/ui/confirm-delete-dialog';
import { PageHeader } from '@/components/layout/page-header';

import { ArrowLeft, Plus } from 'lucide-react';

import {
  useDeleteSavedSearch,
  useListSavedSearches,
  useUpdateSavedSearch,
} from '@/lib/hooks/use-saved-search';

import { SavedSearchCard } from '@/components/samgov/SavedSearchCard';
import { SavedSearchEmptyState } from '@/components/samgov/SavedSearchEmptyState';
import { SavedSearchGridSkeleton } from '@/components/samgov/SavedSearchGridSkeleton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  orgId: string;
  projectId: string;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const ProjectSavedSearchesPage = ({ orgId, projectId }: Props) => {
  const router = useRouter();
  const { toast } = useToast();
  const searchBase = `/organizations/${orgId}/projects/${projectId}/search-opportunities`;

  const { items, isLoading, error, refresh } = useListSavedSearches({ orgId, limit: 50 });
  const { trigger: deleteTrigger, isMutating: isDeleting } = useDeleteSavedSearch();
  const { trigger: updateTrigger, isMutating: isUpdating } = useUpdateSavedSearch();
  const { requestDelete, pendingItem, dialogProps } = useConfirmDelete<SavedSearch>();

  const isBusy = isDeleting || isUpdating;

  // Sort: enabled first, then by most recently updated
  const sorted = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
        return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
      }),
    [items],
  );

  const handleRun = (s: SavedSearch) => {
    router.push(`${searchBase}?search=${encodeURIComponent(JSON.stringify(s.criteria))}`);
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

  const handleToggle = async (s: SavedSearch) => {
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
    <div className="container mx-auto max-w-6xl space-y-8 p-6 lg:p-8">
      {/* ── Back link ──────────────────────────────────────────────── */}
      <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2 gap-1.5">
        <Link href={searchBase}>
          <ArrowLeft className="h-4 w-4" />
          Back to Search
        </Link>
      </Button>

      {/* ── Page header ────────────────────────────────────────────── */}
      <PageHeader
        title="Saved Searches"
        description="Monitor opportunities automatically with scheduled searches."
        actions={
          <Button asChild size="sm" className="gap-1.5">
            <Link href={searchBase}>
              <Plus className="h-4 w-4" />
              New Search
            </Link>
          </Button>
        }
      />

      {/* ── Error banner ───────────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-destructive">Failed to load saved searches</p>
          <p className="mt-1 text-muted-foreground">
            {String((error as Error)?.message ?? error)}
          </p>
        </div>
      )}

      {/* ── Content ────────────────────────────────────────────────── */}
      {isLoading ? (
        <SavedSearchGridSkeleton count={6} />
      ) : sorted.length === 0 ? (
        <SavedSearchEmptyState searchUrl={searchBase} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((s) => (
            <SavedSearchCard
              key={s.savedSearchId}
              savedSearch={s}
              onRun={handleRun}
              onDelete={requestDelete}
              onToggleEnabled={handleToggle}
              disabled={isBusy}
            />
          ))}
        </div>
      )}

      {/* ── Delete confirmation ────────────────────────────────────── */}
      <ConfirmDeleteDialog
        {...dialogProps}
        itemName={pendingItem?.name}
        itemType="saved search"
        onConfirm={handleDelete}
      />
    </div>
  );
};

export default ProjectSavedSearchesPage;
