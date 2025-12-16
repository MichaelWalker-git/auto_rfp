'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FileText, Loader2, RefreshCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { useProposals } from '@/lib/hooks/use-proposal';
import { ProposalStatus } from '@auto-rfp/shared';

function statusVariant(status: ProposalStatus) {
  switch (status) {
    case ProposalStatus.APPROVED:
      return 'default';
    case ProposalStatus.REJECTED:
      return 'destructive';
    case ProposalStatus.IN_REVIEW:
    case ProposalStatus.NEED_REVIEW:
      return 'secondary';
    case ProposalStatus.NEW:
    default:
      return 'outline';
  }
}

export default function ProposalsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId;

  const { items, count, error, isLoading, refresh } = useProposals({
    projectId,
  });

  const sorted = useMemo(() => {
    return [...items].sort((a, b) =>
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
    );
  }, [items]);

  if (!projectId) {
    return (
      <div className="p-6">
        <div className="text-sm text-red-500">Missing projectId in route.</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Proposals</h1>
          <p className="text-sm text-muted-foreground">
            Project: <span className="font-mono">{projectId}</span>
          </p>
        </div>

        <Button
          variant="outline"
          onClick={() => refresh()}
          disabled={isLoading}
          className="gap-2"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-4 border rounded-md p-3">
        <div className="text-sm text-muted-foreground">
          Count: <span className="font-medium text-foreground">{count}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-500 border border-red-500/30 rounded-md px-3 py-2 bg-red-500/5">
          {error instanceof Error ? error.message : 'Failed to load proposals'}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading proposals...
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && sorted.length === 0 && (
        <div className="text-sm text-muted-foreground border rounded-md p-6">
          No proposals yet.
        </div>
      )}

      {/* List */}
      <div className="grid grid-cols-1 gap-3">
        {sorted.map((p) => (
          <div key={p.id} className="border rounded-md p-4 bg-background">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="font-medium">
                    {p.title ?? 'Untitled proposal'}
                  </div>
                  <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                </div>

                <div className="text-xs text-muted-foreground">
                  Updated: {p.updatedAt}
                  <span className="mx-2">•</span>
                  Created: {p.createdAt}
                </div>
              </div>

              <Button variant="outline" size="sm" asChild>
                <Link href={`/projects/${projectId}/proposals/${p.id}`}>Open</Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
