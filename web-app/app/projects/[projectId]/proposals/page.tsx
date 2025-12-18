'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FileText, Loader2, ArrowRight } from 'lucide-react';

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

function formatDate(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ProposalsPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params?.projectId;

  const { items, count, error, isLoading } = useProposals({ projectId });

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
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Proposals</h1>
            <p className="text-sm text-muted-foreground">
              Project <span className="font-mono text-foreground/80">{projectId}</span>
            </p>
          </div>

          {/* subtle live-loading indicator (no reload button) */}
          <div className="h-9 flex items-center">
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-4 border rounded-lg px-3 py-2 bg-muted/30">
          <div className="text-sm text-muted-foreground">
            Total: <span className="font-medium text-foreground">{count}</span>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="text-sm text-red-600 border border-red-500/30 rounded-lg px-3 py-2 bg-red-500/5">
          {error instanceof Error ? error.message : 'Failed to load proposals'}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && sorted.length === 0 && (
        <div className="border rounded-lg p-8 bg-muted/20">
          <div className="text-sm font-medium">No proposals yet</div>
          <div className="text-sm text-muted-foreground mt-1">
            Generate a proposal from extracted Q&amp;A to see it here.
          </div>
        </div>
      )}

      {/* List */}
      <div className="grid grid-cols-1 gap-3">
        {sorted.map((p) => (
          <div
            key={p.id}
            className="group border rounded-lg p-4 bg-background hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="font-medium truncate">
                        {p.title ?? 'Untitled proposal'}
                      </div>
                      <Badge variant={statusVariant(p.status)}>{p.status}</Badge>
                    </div>

                    <div className="text-xs text-muted-foreground">
                      Updated: {formatDate(p.updatedAt)}
                      <span className="mx-2">•</span>
                      Created: {formatDate(p.createdAt)}
                    </div>
                  </div>
                </div>
              </div>

              <Button
                variant="outline"
                size="sm"
                asChild
                className="gap-2 group-hover:border-foreground/30"
              >
                <Link href={`/projects/${projectId}/proposals/${p.id}`}>
                  Open
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}