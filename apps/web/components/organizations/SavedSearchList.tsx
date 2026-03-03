'use client';

import React, { useMemo } from 'react';
import type { LoadSearchOpportunitiesRequest, SavedSearch } from '@auto-rfp/core';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';

import { Plus, Search } from 'lucide-react';

import { useDeleteSavedSearch, useListSavedSearches, useUpdateSavedSearch, } from '@/lib/hooks/use-saved-search';
import { SavedSearchActionsDropdown } from '@/components/organizations/SavedSearchActionsDropdown';

function formatDate(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n)}`;
  }
}

function criteriaChips(c: LoadSearchOpportunitiesRequest): Array<{ label: string; variant?: any }> {
  const chips: Array<{ label: string; variant?: any }> = [];

  if (c.postedFrom || c.postedTo) {
    chips.push({ label: `Posted ${c.postedFrom ?? '—'} → ${c.postedTo ?? '—'}`, variant: 'secondary' });
  }
  if (c.closingFrom || c.closingTo) {
    chips.push({ label: `Closes ${c.closingFrom ?? '—'} → ${c.closingTo ?? '—'}`, variant: 'secondary' });
  }

  if (c.keywords) chips.push({ label: `Keywords: ${c.keywords}` });
  if (c.title) chips.push({ label: `Title: ${c.title}` });

  if (c.naics?.length) chips.push({ label: `NAICS: ${c.naics.length}` });
  if (c.psc?.length) chips.push({ label: `PSC: ${c.psc.length}` });

  if (c.organizationName) chips.push({ label: `Org: ${c.organizationName}` });
  else if (c.organizationCode) chips.push({ label: `Org code: ${c.organizationCode}` });

  if (c.setAsideCode) chips.push({ label: `Set-aside: ${c.setAsideCode}` });

  if (c.ptype?.length) chips.push({ label: `Type: ${c.ptype.join(', ')}` });

  if (c.state) chips.push({ label: `State: ${c.state}` });
  if (c.zip) chips.push({ label: `ZIP: ${c.zip}` });

  if (c.dollarRange?.min != null || c.dollarRange?.max != null) {
    const min = c.dollarRange?.min != null ? formatMoney(c.dollarRange.min) : '—';
    const max = c.dollarRange?.max != null ? formatMoney(c.dollarRange.max) : '—';
    chips.push({ label: `Value: ${min} – ${max}` });
  }

  if (c.limit != null) chips.push({ label: `Limit: ${c.limit}`, variant: 'outline' });
  if (c.offset != null && c.offset !== 0) chips.push({ label: `Offset: ${c.offset}`, variant: 'outline' });

  return chips;
}

function frequencyBadge(f: SavedSearch['frequency']) {
  switch (f) {
    case 'HOURLY':
      return <Badge>Hourly</Badge>;
    case 'WEEKLY':
      return <Badge variant="secondary">Weekly</Badge>;
    case 'DAILY':
    default:
      return <Badge variant="outline">Daily</Badge>;
  }
}

function enabledBadge(v: boolean) {
  return v ? <Badge variant="default">Enabled</Badge> : <Badge variant="secondary">Disabled</Badge>;
}

function EmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border">
        <Search className="h-6 w-6 text-muted-foreground"/>
      </div>
      <div className="text-base font-semibold">No saved searches yet</div>
      <div className="mt-1 max-w-md text-sm text-muted-foreground">
        Save filters (date range, NAICS/PSC, keywords, set-aside, etc.) and run them on a schedule.
      </div>

      {onCreate && (
        <Button className="mt-4 gap-2" onClick={onCreate}>
          <Plus className="h-4 w-4"/>
          Create saved search
        </Button>
      )}
    </div>
  );
}

export function SavedSearchList({
                                  orgId,
                                  onCreate,
                                  onOpen,
                                }: {
  orgId: string;
  onCreate?: () => void;
  onOpen?: (savedSearch: SavedSearch) => void;
}) {
  const { toast } = useToast();

  const { items, isLoading, error, refresh } = useListSavedSearches({ orgId });
  const { trigger: deleteTrigger, isMutating: isDeleting } = useDeleteSavedSearch();

  const { trigger: updateTrigger, isMutating: isUpdating } = useUpdateSavedSearch();

  const isBusy = isDeleting || isUpdating;

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });
  }, [items]);

  const onDelete = async (s: SavedSearch) => {
    try {
      await deleteTrigger({ orgId, savedSearchId: s.savedSearchId });
      await refresh();
      toast({ title: 'Deleted', description: `Saved search “${s.name}” was deleted.` });
    } catch (e: any) {
      toast({
        title: 'Delete failed',
        description: e?.message ?? 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const onToggleEnabled = async (s: SavedSearch) => {
    const nextEnabled = !Boolean(s.isEnabled);

    try {
      // Assumption: your update hook expects { orgId, savedSearchId, patch } or similar.
      // If your signature is different, adjust only this object.
      await updateTrigger({
        orgId,
        savedSearchId: s.savedSearchId,
        patch: { isEnabled: nextEnabled },
      } as any);

      await refresh();

      toast({
        title: nextEnabled ? 'Activated' : 'Disabled',
        description: `Saved search “${s.name}” is now ${nextEnabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (e: any) {
      toast({
        title: 'Update failed',
        description: e?.message ?? 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5"/>
            Saved searches
          </CardTitle>
          <CardDescription>
            {isLoading ? 'Loading…' : `${sorted.length} ${sorted.length === 1 ? 'search' : 'searches'}`}
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          {onCreate && (
            <Button className="gap-2" onClick={onCreate} disabled={isBusy}>
              <Plus className="h-4 w-4"/>
              New search
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <div className="font-medium">Failed to load</div>
            <div className="text-muted-foreground">{String((error as any)?.message ?? error)}</div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full rounded-xl"/>
            <Skeleton className="h-10 w-full rounded-xl"/>
            <Skeleton className="h-10 w-full rounded-xl"/>
          </div>
        ) : sorted.length === 0 ? (
          <EmptyState onCreate={onCreate}/>
        ) : (
          <div className="overflow-hidden rounded-2xl border">
            <div
              className="grid grid-cols-12 gap-3 border-b bg-muted/40 px-4 py-3 text-xs font-medium text-muted-foreground">
              <div className="col-span-4">Name</div>
              <div className="col-span-5">Criteria</div>
              <div className="col-span-1">Schedule</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>

            <div className="divide-y">
              {sorted.map((s) => {
                const chips = criteriaChips(s.criteria);

                return (
                  <div key={s.savedSearchId} className="grid grid-cols-12 gap-3 px-4 py-3 text-sm hover:bg-muted/30">
                    <button
                      type="button"
                      onClick={() => onOpen?.(s)}
                      className="col-span-4 text-left"
                      title="Open"
                    >
                      <div className="flex items-center gap-2">
                        <div className="font-medium leading-5">{s.name}</div>
                        {s.autoImport ? <Badge>Auto-import</Badge> : null}
                      </div>

                      <div className="mt-0.5 text-xs text-muted-foreground">
                        Updated {formatDate(s.updatedAt)} • Last run {formatDate(s.lastRunAt)}
                      </div>

                      {s.notifyEmails?.length ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Notify: {s.notifyEmails.join(', ')}
                        </div>
                      ) : null}
                    </button>

                    <div className="col-span-5 flex flex-wrap items-center gap-2">
                      {chips.slice(0, 6).map((c, idx) => (
                        <Badge key={idx} variant={c.variant ?? 'outline'} className="max-w-full truncate">
                          {c.label}
                        </Badge>
                      ))}
                      {chips.length > 6 ? <Badge variant="secondary">+{chips.length - 6} more</Badge> : null}
                    </div>

                    <div className="col-span-1 flex items-center">{frequencyBadge(s.frequency)}</div>
                    <div className="col-span-1 flex items-center">{enabledBadge(Boolean(s.isEnabled))}</div>

                    <div className="col-span-1 flex items-center justify-end">
                      <SavedSearchActionsDropdown
                        orgId={orgId}
                        savedSearch={s}
                        disabled={isBusy}
                        onToggleEnabled={onToggleEnabled}
                        onDelete={onDelete}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}