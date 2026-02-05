'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CalendarClock, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useCreateOrganization } from '@/lib/hooks/use-create-organization';
import { useOrganizations } from '@/lib/hooks/use-api';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { useCurrentOrganization } from '@/context/organization-context';
import { OrganizationCard } from '@/components/organizations/OrganizationCard';
import { CreateEditOrganizationDialog } from '@/components/organizations/CreateEditOrganizationDialog';
import { EmptyOrganizationsState } from '@/components/organizations/EmptyOrganizationsState';
import { useDeleteOrganization } from '@/lib/hooks/use-delete-organization';
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
  slug: string;
  description?: string;
  aiProcessingEnabled: boolean;
  autoApprovalThreshold: number;
  createdAt: string;
  updatedAt: string;
  organizationUsers: Array<{
    id: string;
    role: string;
    user: {
      id: string;
      email: string;
      name?: string;
    };
  }>;
  projects: Array<{
    id: string;
    name: string;
    description?: string;
    createdAt: string;
  }>;
  _count: {
    projects: number;
    organizationUsers: number;
  };
}

interface CreateOrganizationData {
  name: string;
  slug: string;
  description: string;
}

export default function OrganizationsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [orgToDelete, setOrgToDelete] = useState<Organization | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const { data: organizations, error, mutate: fetchOrganizations, isLoading: loading } = useOrganizations();
  const { deleteOrganization } = useDeleteOrganization();
  const { createOrganization } = useCreateOrganization();
  const { toast } = useToast();
  const { orgId } = useAuth();
  const router = useRouter();
  const { setCurrentOrganization } = useCurrentOrganization();

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

  useEffect(() => {
    if (orgId) {
      router.replace(`/organizations/${orgId}`);
    }
  }, [orgId, router]);

  const generateSlugFromName = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  };

  const handleCreateOrganization = async () => {
    try {
      setIsCreating(true);
      const data = await createOrganization({
        ...formData,
        slug: generateSlugFromName(formData.name),
      });

      if (data.id) {
        toast({
          title: 'Success',
          description: 'Organization created successfully',
        });

        setCreateDialogOpen(false);
        setFormData({
          name: '',
          slug: '',
          description: '',
        });
        fetchOrganizations();
      } else {
        toast({
          title: 'Error',
          description: 'Failed to create organization',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create organization',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleUpdateOrganization = async () => {
    if (!editingOrg) return;

    try {
      setIsUpdating(true);
      const response = await fetch(`/organization/edit-organization/${editingOrg.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Organization updated successfully',
        });
        setEditingOrg(null);
        fetchOrganizations();
      } else {
        toast({
          title: 'Error',
          description: data.error || 'Failed to update organization',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update organization',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleOpenEditDialog = (org: Organization) => {
    setEditingOrg(org);
    setFormData({
      name: org.name,
      slug: org.slug,
      description: org.description || '',
    });
  };

  const handleCloseDialog = () => {
    setEditingOrg(null);
    setCreateDialogOpen(false);
    setFormData({
      name: '',
      slug: '',
      description: '',
    });
  };

  const handleVisitOrganization = (org: Organization) => {
    setCurrentOrganization(org);
  };

  const handleCreateDialogSubmit = () => {
    if (editingOrg) {
      handleUpdateOrganization();
    } else {
      handleCreateOrganization();
    }
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

      toast({
        title: 'Success',
        description: `Organization "${orgToDelete.name}" has been deleted successfully.`,
      });

      // Refresh the organizations list
      fetchOrganizations();
    } catch (error) {
      console.error('Failed to delete organization:', error);
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

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto">
        <div className="py-6 px-4 sm:px-6">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h1 className="text-3xl font-bold">Organizations</h1>
            </div>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-gradient-to-br from-background to-muted/30 animate-pulse">
                  <div className="p-4 space-y-2">
                    <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto">
      <div className="py-6 px-4 sm:px-6 pt-20">
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Organizations</h1>
              <p className="text-muted-foreground">
                Manage organizations and their settings
              </p>
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button variant='outline' onClick={() => router.push('/deadlines')}>
                <CalendarClock className="mr-2 h-4 w-4" />
                Check the deadlines
              </Button>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Organization
              </Button>
            </div>
          </div>

          {organizations?.length === 0 ? (
            <EmptyOrganizationsState onCreateClick={() => setCreateDialogOpen(true)} />
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {organizations
                ?.filter((org: Organization | null | undefined): org is Organization =>
                  org != null && typeof org.id === 'string'
                )
                .map((org: Organization) => (
                  <OrganizationCard
                    key={org.id}
                    organization={org}
                    onDelete={handleDeleteClick}
                  />
                ))}
            </div>
          )}

          <CreateEditOrganizationDialog
            isOpen={createDialogOpen || !!editingOrg}
            onOpenChange={handleCloseDialog}
            isLoading={isCreating || isUpdating}
            formData={formData}
            onFormChange={setFormData}
            onSubmit={handleCreateDialogSubmit}
            editingOrg={editingOrg}
          />

          <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the organization
                  <span className="font-semibold"> "{orgToDelete?.name}"</span> and remove all associated data
                  including projects, users, and settings.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleConfirmDelete}
                  disabled={isDeleting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {isDeleting ? 'Deleting...' : 'Delete Organization'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}