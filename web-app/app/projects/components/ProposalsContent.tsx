'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

import { useProposals } from '@/lib/hooks/use-proposal';
import { ProposalStatus } from '@auto-rfp/shared';
import { NoRfpDocumentAvailable, useQuestions } from '@/app/projects/[projectId]/questions/components';
import { GenerateProposalModal } from '@/app/projects/[projectId]/questions/components/GenerateProposalModal';

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
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type Props = {
  projectId: string;
};

export default function ProposalsContent({ projectId }: Props) {
  const { questionFiles, isLoading: isQL, error: err, refreshQuestions } = useQuestions();
  if (!isQL && !err && !questionFiles?.length) {
    return <NoRfpDocumentAvailable projectId={projectId}/>;
  }
  const { items, count, error, isLoading, refresh } = useProposals({ projectId });


  const sorted = useMemo(() => {
    return [...(items ?? [])].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [items]);

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Missing projectId</CardTitle>
          <CardDescription>Project route param is not available.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5"/>
              Proposals
            </CardTitle>
          </div>
          <Skeleton className="h-9 w-28"/>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full"/>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5"/>
              Proposals
            </CardTitle>
            <CardDescription>Review and open generated proposals</CardDescription>
          </div>

          <div className="h-9 flex items-center">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin"/>
              Loading…
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border bg-red-50 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5"/>
              <div className="flex-1">
                <p className="font-medium text-red-900">Couldn’t load proposals</p>
                <p className="text-sm text-red-700 mt-1">
                  {error instanceof Error ? error.message : 'Unknown error'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5"/>
            Proposals
          </CardTitle>
          <CardDescription>
            {count ?? sorted.length} {(count ?? sorted.length) === 1 ? 'proposal' : 'proposals'} in this project
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin"/>
              Loading…
            </div>
          )}
          <GenerateProposalModal projectId={projectId} onSave={(p) => refresh()}/>
        </div>
      </CardHeader>

      <CardContent>
        {sorted.length === 0 ? (
          <div className="text-center py-10">
            <FileText className="mx-auto h-9 w-9 text-muted-foreground mb-3"/>
            <h3 className="text-lg font-medium">No proposals yet</h3>
            <p className="text-muted-foreground mt-1">Generate a proposal from extracted Q&amp;A to see it here.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((p) => (
              <Link key={p.id} href={`/projects/${projectId}/proposals/${p.id}`}>
                <div className="rounded-xl border bg-background p-3">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <FileText className="h-5 w-5 text-muted-foreground"/>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium truncate" title={p.title ?? 'Untitled proposal'}>
                          {p.title ?? 'Untitled proposal'}
                        </p>
                        <Badge variant={statusVariant(p.status)} className="text-xs">
                          {p.status}
                        </Badge>
                      </div>

                      <div className="mt-1 text-xs text-muted-foreground">
                        Updated: {formatDate(p.updatedAt)}
                        <span className="mx-2">•</span>
                        Created: {formatDate(p.createdAt)}
                      </div>

                      <div className="mt-1 text-xs text-muted-foreground">
                        Project: <span className="font-mono">{projectId}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}