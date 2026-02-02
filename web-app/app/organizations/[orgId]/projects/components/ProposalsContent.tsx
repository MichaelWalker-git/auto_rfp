'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, FileText } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';

import { useProposals } from '@/lib/hooks/use-proposal';
import { Proposal, ProposalStatus } from '@auto-rfp/shared';
import {
  NoRfpDocumentAvailable,
  useQuestions
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';
import {
  GenerateProposalModal
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components/GenerateProposalModal';
import { useCurrentOrganization } from '@/context/organization-context';
import { formatDateTime } from '@/components/brief/helpers';

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

type Props = {
  projectId: string;
};

export default function ProposalsContent({ projectId }: Props) {
  const { questionFiles, isLoading: isQL, error: err, refreshQuestions } = useQuestions();
  const { currentOrganization } = useCurrentOrganization();
  if (!isQL && !err && !questionFiles?.length) {
    return <NoRfpDocumentAvailable projectId={projectId}/>;
  }
  const { items, count, error, isLoading, refresh } = useProposals({ projectId });
  const [searchQuery, setSearchQuery] = useState('');


  const sorted = useMemo(() => {
    return [...(items ?? [])].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }, [items]);

  const filteredProposals = useMemo(() => {
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter((p) =>
      (p.title?.toLowerCase().includes(q) ?? false) ||
      (p.status?.toLowerCase().includes(q) ?? false)
    );
  }, [sorted, searchQuery]);

  const handleReload = useCallback(async () => {
    await refresh();
  }, [refresh]);

  if (!projectId) {
    return (
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <ListingPageLayout
          title="Proposals"
          description="Error: Missing project ID"
          isLoading={false}
        >
          <div className="text-center py-10">
            <AlertCircle className="mx-auto h-9 w-9 text-red-500 mb-3"/>
            <h3 className="text-lg font-medium">Missing projectId</h3>
            <p className="text-muted-foreground mt-1">Project route param is not available.</p>
          </div>
        </ListingPageLayout>
      </div>
    );
  }

  const emptyState = (
    <div className="text-center py-10">
      <FileText className="mx-auto h-9 w-9 text-muted-foreground mb-3"/>
      <h3 className="text-lg font-medium">No proposals yet</h3>
      <p className="text-muted-foreground mt-1">Generate a proposal from extracted Q&amp;A to see it here.</p>
    </div>
  );

  const renderProposalItem = (p: Proposal) => <Link key={p.id} href={`/organizations/${currentOrganization?.id}/projects/${projectId}/proposals/${p.id}`}>
    <div className="rounded-lg border bg-background p-4 hover:bg-muted/50 transition-colors">
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
            Updated: {formatDateTime(p.updatedAt)}
            <span className="mx-2">•</span>
            Created: {formatDateTime(p.createdAt)}
          </div>
        </div>
      </div>
    </div>
  </Link>;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <ListingPageLayout
        title="Proposals"
        description={`${count ?? filteredProposals.length} ${(count ?? filteredProposals.length) === 1 ? 'proposal' : 'proposals'} in this project`}
        headerActions={<GenerateProposalModal projectId={projectId} onSave={(p) => refresh()}/>}
        isLoading={isLoading}
        onReload={handleReload}
        emptyState={filteredProposals.length === 0 ? emptyState : undefined}
        data={filteredProposals}
        renderItem={renderProposalItem}
      />
    </div>
  );
}