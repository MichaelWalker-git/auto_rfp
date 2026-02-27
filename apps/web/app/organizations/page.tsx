'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CalendarClock, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useCreateOrganization } from '@/lib/hooks/use-create-organization';
import { useOrganizations } from '@/lib/hooks/use-api';
import { useRouter } from 'next/navigation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { useCurrentOrganization } from '@/context/organization-context';
import { OrganizationCard } from '@/components/organizations/OrganizationCard';
import { CreateEditOrganizationDialog } from '@/components/organizations/CreateEditOrganizationDialog';
import { EmptyOrganizationsState } from '@/components/organizations/EmptyOrganizationsState';
import { useDeleteOrganization } from '@/lib/hooks/use-delete-organization';
import { GlobalHeader } from '@/components/global/global-header';
import { Skeleton } from '@/components/ui/skeleton';
import type { OrganizationItem } from '@auto-rfp/core';
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

// ─── Loading skeleton ─────────────────────────────────────────────────────────

const OrganizationsLoadingSkeleton = () => (
  <div className="w-full max-w-7xl mx-auto">
    <div className="container mx-auto p-12">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    </div>
  </div>
);

// ─── Page header ──────────────────────────────────────────────────────────────

const OrganizationsHeader = ({
  onCreateClick,
  onDeadlinesClick,
}: {
  onCreateClick: () => void;
  onDeadlinesClick: () => void;
}) => (
  <div className="flex items-center justify-between">
    <div>
      <h1 className="text-3xl font-bold">Organizations</h1>
      <p className="text-muted-foreground">Manage organizations and their settings</p>
    </div>
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={onDeadlinesClick}>
        <CalendarClock className="mr-2 h-4 w-4" />
        Deadlines
      </Button>
      <Button onClick={onCreateClick}>
        <Plus className="mr-2 h-4 w-4" />
        New Organization
      </Button>
    </div>
  </div>
);

// ─── Org grid ─────────────────────────────────────────────────────────────────

const OrganizationsGrid = ({
  organizations,
  onDelete,
}: {
  organizations: OrganizationItem[];
  onDelete: (org: OrganizationItem) => void;
}) => (
  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
    {organizations
      .filter((org): org is OrganizationItem => org != null && typeof org.id === 'string')
      .map((org) => (
        <OrganizationCard key={org.id} organization={org} onDelete={onDelete} />
      ))}
  </div>
);

// ─── Delete confirmation ──────────────────────────────────────────────────────

const DeleteOrganizationDialog = ({
  isOpen,
  onOpenChange,
  organization,
  isDeleting,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organization: OrganizationItem | null;
  isDeleting: boolean;
  onConfirm: () => void;
}) => (
  <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
        <AlertDialogDescription>
          This action cannot be undone. This will permanently delete{' '}
          <span className="font-semibold">&ldquo;{organization?.name}&rdquo;</span> and remove all
          associated data including projects, users, and settings.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={onConfirm}
          disabled={isDeleting}
          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          {isDeleting ? 'Deleting…' : 'Delete Organization'}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OrganizationsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { setCurrentOrganization } = useCurrentOrganization();
  const { createOrganization } = useCreateOrganization();
  const { deleteOrganization } = useDeleteOrganization();
  const { data: organizations, error, mutate: refresh, isLoading } = useOrganizations();

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<OrganizationItem | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [orgToDelete, setOrgToDelete] = useState<OrganizationItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [formData, setFormData] = useState({ name: '', slug: '', description: '' });

  useEffect(() => {
    if (error) {
      toast({ title: 'Error', description: 'Failed to fetch organizations', variant: 'destructive' });
    }
  }, [error, toast]);

  const handleCloseDialog = () => {
    setEditingOrg(null);
    setCreateDialogOpen(false);
    setFormData({ name: '', slug: '', description: '' });
  };

  const handleCreateOrganization = async () => {
    try {
      setIsCreating(true);
      const data = await createOrganization({
        name: formData.name,
        description: formData.description || undefined,
      });
      if (data.id) {
        toast({ title: 'Organization created' });
        handleCloseDialog();
        refresh();
      } else {
        toast({ title: 'Error', description: 'Failed to create organization', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to create organization', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateOrganization = async () => {
    if (!editingOrg) return;
    try {
      setIsUpdating(true);
      const res = await authFetcher(`${env.BASE_API_URL}/organization/edit-organization/${editingOrg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: formData.name, description: formData.description || undefined }),
      });
      const data = await res.json() as OrganizationItem;
      if (res.ok) {
        toast({ title: 'Organization updated' });
        handleCloseDialog();
        refresh();
      } else {
        toast({ title: 'Error', description: (data as unknown as { message?: string }).message ?? 'Failed to update', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update organization', variant: 'destructive' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteClick = (org: OrganizationItem) => {
    setOrgToDelete(org);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!orgToDelete) return;
    try {
      setIsDeleting(true);
      await deleteOrganization(orgToDelete.id);
      toast({ title: 'Deleted', description: `"${orgToDelete.name}" has been deleted.` });
      refresh();
    } catch {
      toast({ title: 'Error', description: `Failed to delete "${orgToDelete.name}".`, variant: 'destructive' });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmOpen(false);
      setOrgToDelete(null);
    }
  };

  if (isLoading) return (
    <>
      <GlobalHeader />
      <OrganizationsLoadingSkeleton />
    </>
  );

  return (
    <>
      <GlobalHeader />
      <div className="w-full max-w-7xl mx-auto">
        <div className="container mx-auto p-12 space-y-6">
          <OrganizationsHeader
            onCreateClick={() => setCreateDialogOpen(true)}
            onDeadlinesClick={() => router.push('/deadlines')}
          />

          {(organizations?.length ?? 0) === 0 ? (
            <EmptyOrganizationsState onCreateClick={() => setCreateDialogOpen(true)} />
          ) : (
            <OrganizationsGrid
              organizations={(organizations ?? []) as OrganizationItem[]}
              onDelete={handleDeleteClick}
            />
          )}

          <CreateEditOrganizationDialog
            isOpen={createDialogOpen || !!editingOrg}
            onOpenChange={handleCloseDialog}
            isLoading={isCreating || isUpdating}
            formData={formData}
            onFormChange={setFormData}
            onSubmit={editingOrg ? handleUpdateOrganization : handleCreateOrganization}
            editingOrg={editingOrg}
          />

          <DeleteOrganizationDialog
            isOpen={deleteConfirmOpen}
            onOpenChange={setDeleteConfirmOpen}
            organization={orgToDelete}
            isDeleting={isDeleting}
            onConfirm={handleConfirmDelete}
          />
        </div>
      </div>
    </>
  );
}
