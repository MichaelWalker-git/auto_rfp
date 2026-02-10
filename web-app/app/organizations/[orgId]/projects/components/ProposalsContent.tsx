'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, FileText, Loader2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

import { useProposals, useDeleteProposal } from '@/lib/hooks/use-proposal';
import { Proposal, ProposalStatus } from '@auto-rfp/shared';
import PermissionWrapper from '@/components/permission-wrapper';
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
  // All hooks must be called before any conditional returns
  const { questionFiles, isLoading: isQL, error: err } = useQuestions();
  const { currentOrganization } = useCurrentOrganization();
  const { items, count, isLoading, refresh } = useProposals({ projectId });
  const { trigger: deleteProposal } = useDeleteProposal();
  const [searchQuery, _setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [proposalToDelete, setProposalToDelete] = useState<Proposal | null>(null);

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

  const handleDeleteClick = useCallback((e: React.MouseEvent, proposal: Proposal) => {
    e.preventDefault();
    e.stopPropagation();
    setProposalToDelete(proposal);
    setDeleteDialogOpen(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!proposalToDelete?.id) return;
    if (deletingId === proposalToDelete.id) return;

    try {
      setDeletingId(proposalToDelete.id);
      await deleteProposal({ projectId, proposalId: proposalToDelete.id });
      await refresh();
      setDeleteDialogOpen(false);
      setProposalToDelete(null);
    } finally {
      setDeletingId((prev) => (prev === proposalToDelete.id ? null : prev));
    }
  }, [projectId, deleteProposal, refresh, deletingId, proposalToDelete]);

  // Early return after all hooks have been called
  if (!isQL && !err && !questionFiles?.length) {
    return <NoRfpDocumentAvailable projectId={projectId}/>;
  }

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

  const renderProposalItem = (p: Proposal) => {
    const isDeleting = deletingId === p.id;
    
    return (
      <div key={p.id} className="rounded-lg border bg-background p-4 hover:bg-muted/50 transition-colors">
        <div className="flex items-start gap-3">
          <Link 
            href={`/organizations/${currentOrganization?.id}/projects/${projectId}/proposals/${p.id}`}
            className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0"
          >
            <FileText className="h-5 w-5 text-muted-foreground"/>
          </Link>

          <Link 
            href={`/organizations/${currentOrganization?.id}/projects/${projectId}/proposals/${p.id}`}
            className="min-w-0 flex-1"
          >
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
          </Link>

          <div className="flex items-center gap-2 shrink-0">
            <PermissionWrapper requiredPermission="proposal:delete">
              <Button
                size="sm"
                variant="destructive"
                className="gap-2"
                disabled={!p.id || isDeleting}
                onClick={(e) => handleDeleteClick(e, p)}
                title="Delete proposal"
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin"/> : <Trash2 className="h-4 w-4"/>}
              </Button>
            </PermissionWrapper>
          </div>
        </div>
      </div>
    );
  };

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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Proposal</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{proposalToDelete?.title ?? 'Untitled proposal'}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deletingId === proposalToDelete?.id}
              onClick={() => {
                setDeleteDialogOpen(false);
                setProposalToDelete(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deletingId === proposalToDelete?.id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingId === proposalToDelete?.id ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin"/>
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
