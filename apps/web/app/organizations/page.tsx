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

export interface Organization {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  iconKey?: string;
  bucketName?: string;
  aiProcessingEnabled?: boolean;
  autoApprovalThreshold?: number;
  createdAt?: string;
  updatedAt?: string;
  organizationUsers?: Array<{
    id: string;
    role: string;
    user: { id: string; email: string; name?: string };
  }>;
  projects?: Array<{
    id: string;
    name: string;
    description?: string;
    createdAt: string;
  }>;
  _count?: { projects: number; organizationUsers: number };
}

interface CreateOrganizationData {
  name: string;
  slug: string;
  description: string;
}

// ─── Loading skeleton ───

function OrganizationsLoadingSkeleton() {
  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="container mx-auto p-12">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h1 className="text-3xl font-bold">Organizations</h1>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="rounded-lg border border-border bg-gradient-to-br from-background to-muted/30 animate-pulse"
              >
                <div className="p-4 space-y-2">
                  <div className="h-6 bg-gray-200 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page header ───

function OrganizationsHeader({
  onCreateClick,
  onDeadlinesClick,
}: {
  onCreateClick: () => void;
  onDeadlinesClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">Organizations</h1>
        <p className="text-muted-foreground">
          Manage organizations and their settings
        </p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" onClick={onDeadlinesClick}>
          <CalendarClock className="mr-2 h-4 w-4" />
          Check the deadlines
        </Button>
        <Button onClick={onCreateClick}>
          <Plus className="mr-2 h-4 w-4" />
          Create Organization
        </Button>
      </div>
    </div>
  );
}

// ─── Org grid ───

function OrganizationsGrid({
  organizations,
  onDelete,
}: {
  organizations: Organization[];
  onDelete: (org: Organization) => void;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {organizations
        .filter(
          (org): org is Organization =>
            org != null && typeof org.id === 'string',
        )
        .map((org) => (
          <OrganizationCard
            key={org.id}
            organization={org}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

// ─── Delete confirmation ───

function DeleteOrganizationDialog({
  isOpen,
  onOpenChange,
  organization,
  isDeleting,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  organization: Organization | null;
  isDeleting: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            organization
            <span className="font-semibold">
              {' '}
              &ldquo;{organization?.name}&rdquo;
            </span>{' '}
            and remove all associated data including projects, users, and
            settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? 'Deleting...' : 'Delete Organization'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─── Main page ───

export default function OrganizationsPage() {
  const { toast } = useToast();
  const router = useRouter();
  const { setCurrentOrganization } = useCurrentOrganization();
  const { createOrganization } = useCreateOrganization();
  const { deleteOrganization } = useDeleteOrganization();
  const {
    data: organizations,
    error,
    mutate: fetchOrganizations,
    isLoading: loading,
  } = useOrganizations();

  // Dialog state
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  // Delete state
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [orgToDelete, setOrgToDelete] = useState<Organization | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Form state
  const [formData, setFormData] = useState<CreateOrganizationData>({
    name: '',
    slug: '',
    description: '',
  });

  useEffect(() => {
    if (error) {
      toast({
        title: 'Error',
        description: 'Failed to fetch organizations',
        variant: 'destructive',
      });
    }
  }, [error, toast]);

  const handleCreateOrganization = async () => {
    try {
      setIsCreating(true);
      const data = await createOrganization({
        name: formData.name,
        description: formData.description || undefined,
      });

      if (data.id) {
        toast({ title: 'Success', description: 'Organization created successfully' });
        handleCloseDialog();
        fetchOrganizations();
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
      const url = `${env.BASE_API_URL}/organization/edit-organization/${editingOrg.id}`;
      const response = await authFetcher(url, {
        method: 'PATCH',
        body: JSON.stringify({
          name: formData.name,
          description: formData.description || undefined,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        toast({ title: 'Success', description: 'Organization updated successfully' });
        handleCloseDialog();
        fetchOrganizations();
      } else {
        toast({ title: 'Error', description: data.message || 'Failed to update organization', variant: 'destructive' });
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to update organization', variant: 'destructive' });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCloseDialog = () => {
    setEditingOrg(null);
    setCreateDialogOpen(false);
    setFormData({ name: '', slug: '', description: '' });
  };

  const handleDeleteClick = (org: Organization) => {
    setOrgToDelete(org);
    setDeleteConfirmOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!orgToDelete) return;

    try {
      setIsDeleting(true);
      await deleteOrganization(orgToDelete.id);
      toast({ title: 'Success', description: `Organization "${orgToDelete.name}" has been deleted successfully.` });
      fetchOrganizations();
    } catch (err) {
      console.error('Failed to delete organization:', err);
      toast({
        title: 'Error',
        description: `Failed to delete organization "${orgToDelete.name}". Please try again.`,
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setDeleteConfirmOpen(false);
      setOrgToDelete(null);
    }
  };

  if (loading) return (
    <>
      <GlobalHeader />
      <OrganizationsLoadingSkeleton />
    </>
  );

  return (
    <>
      <GlobalHeader />
      <div className="w-full max-w-7xl mx-auto">
        <div className="container mx-auto p-12">
        <div className="space-y-6">
          <OrganizationsHeader
            onCreateClick={() => setCreateDialogOpen(true)}
            onDeadlinesClick={() => router.push('/deadlines')}
          />

          {organizations?.length === 0 ? (
            <EmptyOrganizationsState onCreateClick={() => setCreateDialogOpen(true)} />
          ) : (
            <OrganizationsGrid
              organizations={organizations ?? []}
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
      </div>
    </>
  );
}
