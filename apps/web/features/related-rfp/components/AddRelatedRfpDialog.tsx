'use client';

import { useState } from 'react';
import { Check, ExternalLink, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import type { AgencyHistoryItem } from '@auto-rfp/core';

import { useAgencyHistory } from '../hooks/useAgencyHistory';
import { formatRelatedDate } from '../lib/format';

interface AddRelatedRfpDialogProps {
  orgId: string;
  projectId: string;
  oppId: string;
  onAdd: (item: AgencyHistoryItem) => Promise<void>;
}

/**
 * Manual-add picker (HOR-2610): searches the issuing agency's RFP history on
 * HigherGov and lets the user link a past RFP to the current opportunity.
 */
export const AddRelatedRfpDialog = ({ orgId, projectId, oppId, onAdd }: AddRelatedRfpDialogProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [addingKey, setAddingKey] = useState<string | null>(null);

  const { items, isLoading, isError } = useAgencyHistory({
    orgId,
    projectId,
    oppId,
    q: query,
    enabled: open,
  });

  const handleAdd = async (item: AgencyHistoryItem) => {
    setAddingKey(item.relatedOppKey);
    try {
      await onAdd(item);
    } finally {
      setAddingKey(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Add related RFP
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a related RFP</DialogTitle>
          <DialogDescription>
            Search the issuing agency&apos;s past and present RFPs on HigherGov and link one to this
            opportunity.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title or keyword…"
            className="pl-9"
          />
        </div>

        <div className="max-h-96 space-y-2 overflow-y-auto">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </>
          ) : isError ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Couldn&apos;t load agency history. Try again shortly.
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No matching RFPs found for this agency.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.relatedOppKey}
                className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{item.title}</span>
                    {item.sourceUrl && (
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label="Open on HigherGov"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    {item.organizationName && <span className="truncate">{item.organizationName}</span>}
                    <span>Posted {formatRelatedDate(item.postedDateIso)}</span>
                    <span>Due {formatRelatedDate(item.dueDateIso)}</span>
                  </div>
                </div>

                {item.alreadyRelated ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5" />
                    Added
                  </span>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    disabled={addingKey === item.relatedOppKey}
                    onClick={() => handleAdd(item)}
                  >
                    {addingKey === item.relatedOppKey ? 'Adding…' : 'Add'}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
