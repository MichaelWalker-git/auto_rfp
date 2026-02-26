'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Bookmark, Calendar, Clock, Play, Search, Tag, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BaseCard } from '@/components/ui/base-card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';
import { useDeleteSavedSearch, useListSavedSearches, useUpdateSavedSearch } from '@/lib/hooks/use-saved-search';
import type { SavedSearch } from '@auto-rfp/core';

interface Props { orgId: string; projectId: string; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtDate = (iso?: string | null) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const SOURCE_COLORS: Record<string, string> = {
  SAM_GOV: 'bg-blue-50 text-blue-700 border-blue-200',
  DIBBS:   'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const FREQ: Record<string, string> = { HOURLY: 'Hourly', DAILY: 'Daily', WEEKLY: 'Weekly' };

// ─── Card ─────────────────────────────────────────────────────────────────────

const SavedSearchCard = ({ s, onRun, onDelete, onToggle, isDeleting, isUpdating }: {
  s: SavedSearch;
  onRun: (s: SavedSearch) => void;
  onDelete: (s: SavedSearch) => void;
  onToggle: (s: SavedSearch) => void;
  isDeleting: boolean; isUpdating: boolean;
}) => {
  const c = s.criteria;
  const srcColor = SOURCE_COLORS[s.source ?? 'SAM_GOV'] ?? SOURCE_COLORS['SAM_GOV']!;

  const summary: string[] = [];
  if (c.keywords) summary.push(`"${c.keywords}"`);
  if (c.naics?.length) summary.push(`NAICS: ${c.naics.join(', ')}`);
  if (c.setAsideCode) summary.push(c.setAsideCode);
  if (c.postedFrom || c.postedTo) summary.push(`Posted ${c.postedFrom ?? '—'} → ${c.postedTo ?? '—'}`);

  return (
    <BaseCard
      title={s.name}
      subtitle={summary.length ? summary.join(' · ') : 'No filters — matches all opportunities'}
      isHoverable
      className={!s.isEnabled ? 'opacity-60' : ''}
      actions={
        <div className="flex items-center gap-1">
          <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(s); }}
            disabled={isUpdating} title={s.isEnabled ? 'Pause' : 'Enable'}
            className="p-1 rounded hover:bg-muted transition-colors">
            {s.isEnabled
              ? <ToggleRight className="h-4 w-4 text-emerald-600" />
              : <ToggleLeft className="h-4 w-4 text-muted-foreground" />}
          </button>
          <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onDelete(s); }}
            disabled={isDeleting} title="Delete"
            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground/70">
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full border text-xs font-medium ${srcColor}`}>
              {s.source ?? 'SAM.gov'}
            </span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{FREQ[s.frequency] ?? s.frequency}</span>
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{fmtDate(s.lastRunAt)}</span>
            {s.autoImport && <Badge variant="outline" className="text-xs h-4 px-1 text-emerald-600 border-emerald-300">Auto</Badge>}
          </div>
          <button type="button" onClick={e => { e.preventDefault(); e.stopPropagation(); onRun(s); }}
            className="flex items-center gap-1 text-xs text-primary hover:underline underline-offset-2 font-medium">
            <Play className="h-3 w-3" />Run
          </button>
        </div>
      }
    />
  );
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const LoadingSkeleton = () => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="rounded-xl border overflow-hidden">
        <div className="p-4 space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="px-4 py-2 border-t bg-muted/30 flex gap-2">
          <Skeleton className="h-4 w-16 rounded-full" />
          <Skeleton className="h-4 w-12" />
        </div>
      </div>
    ))}
  </div>
);

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyState = ({ searchBase }: { searchBase: string }) => (
  <div className="flex flex-col items-center justify-center py-16 text-center border rounded-xl bg-muted/10">
    <div className="rounded-full bg-primary/10 p-4 mb-4">
      <Bookmark className="h-8 w-8 text-primary" />
    </div>
    <h3 className="text-lg font-medium mb-2">No saved searches yet</h3>
    <p className="text-sm text-muted-foreground max-w-sm mb-6">
      Save your search filters to run them automatically on a schedule.
    </p>
    <Button asChild>
      <Link href={searchBase}><Search className="mr-2 h-4 w-4" />Go to Search</Link>
    </Button>
  </div>
);

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProjectSavedSearchesPage({ orgId, projectId }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const searchBase = `/organizations/${orgId}/projects/${projectId}/search-opportunities`;

  const { items, isLoading, error, refresh } = useListSavedSearches({ orgId, limit: 50 });
  const { trigger: deleteTrigger, isMutating: isDeleting } = useDeleteSavedSearch();
  const { trigger: updateTrigger, isMutating: isUpdating } = useUpdateSavedSearch();

  const handleRun = (s: SavedSearch) => {
    router.push(`${searchBase}?search=${encodeURIComponent(JSON.stringify(s.criteria))}`);
  };

  const handleDelete = async (s: SavedSearch) => {
    try {
      await deleteTrigger({ orgId, savedSearchId: s.savedSearchId });
      await refresh();
      toast({ title: 'Deleted', description: `"${s.name}" was deleted.` });
    } catch (e: unknown) {
      toast({ title: 'Delete failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const handleToggle = async (s: SavedSearch) => {
    const next = !s.isEnabled;
    try {
      await updateTrigger({ orgId, savedSearchId: s.savedSearchId, patch: { isEnabled: next } } as any);
      await refresh();
      toast({ title: next ? 'Enabled' : 'Paused', description: `"${s.name}" is now ${next ? 'active' : 'paused'}.` });
    } catch (e: unknown) {
      toast({ title: 'Update failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' });
    }
  };

  const sorted = [...items].sort((a, b) => {
    if (a.isEnabled !== b.isEnabled) return a.isEnabled ? -1 : 1;
    return new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime();
  });

  return (
    <div className="container mx-auto p-8 max-w-6xl">
      <div className="mb-6">
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground -ml-2">
          <Link href={searchBase}><ArrowLeft className="h-4 w-4 mr-1.5" />Back to Search</Link>
        </Button>
      </div>

      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Saved Searches</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {isLoading ? 'Loading…' : `${sorted.length} saved search${sorted.length !== 1 ? 'es' : ''}`}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={searchBase}><Search className="mr-2 h-4 w-4" />New Search</Link>
        </Button>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Failed to load saved searches.
        </div>
      )}

      {isLoading ? <LoadingSkeleton />
        : sorted.length === 0 ? <EmptyState searchBase={searchBase} />
        : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map(s => (
              <SavedSearchCard key={s.savedSearchId} s={s}
                onRun={handleRun} onDelete={handleDelete} onToggle={handleToggle}
                isDeleting={isDeleting} isUpdating={isUpdating} />
            ))}
          </div>
        )}
    </div>
  );
}
