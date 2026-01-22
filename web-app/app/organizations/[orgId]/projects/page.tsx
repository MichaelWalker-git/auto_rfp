'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';

import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { useOrganization, useProjects } from '@/lib/hooks/use-api';
import { Project } from '@/types/project';

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
import { useDeleteProject } from '@/lib/hooks/use-project';
import PermissionWrapper from '@/components/permission-wrapper';

export default function OrganizationPage() {
  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const { toast } = useToast();

  const { orgId } = useParams<{ orgId: string }>();

  const {
    data: organization,
    error: orgError,
    isLoading: isOrgLoading,
  } = useOrganization(orgId);

  const {
    data: projects,
    isLoading: isProjectsLoading,
    mutate: refetchProjects,
  } = useProjects(orgId);

  const { trigger: deleteProjectTrigger, isMutating: isDeleting } = useDeleteProject();

  // Confirm delete dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);

  const confirmTitle = useMemo(() => {
    return pendingProject ? `Delete "${pendingProject.name}"?` : 'Delete project?';
  }, [pendingProject]);

  const confirmDescription = useMemo(() => {
    return pendingProject
      ? 'This action cannot be undone. All project data may be removed.'
      : 'This action cannot be undone.';
  }, [pendingProject]);

  useEffect(() => {
    if (orgError) {
      console.error('Error fetching organization:', orgError);
      toast({
        title: 'Error',
        description: 'Failed to load organization data',
        variant: 'destructive',
      });
    }
  }, [orgError, toast]);

  const isLoading = isOrgLoading || isProjectsLoading;

  if (!orgId) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col gap-4 w-full max-w-4xl">
          <div className="h-12 bg-gray-200 rounded w-1/3"/>
          <div className="h-4 bg-gray-200 rounded w-1/2"/>
          <div className="h-64 bg-gray-200 rounded w-full mt-4"/>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse flex flex-col gap-4 w-full max-w-4xl">
          <div className="h-12 bg-gray-200 rounded w-1/3"/>
          <div className="h-4 bg-gray-200 rounded w-1/2"/>
          <div className="h-64 bg-gray-200 rounded w-full mt-4"/>
        </div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <h1 className="text-2xl font-bold">Organization not found</h1>
        <p className="text-gray-600 mb-4">
          The organization you&apos;re looking for doesn&apos;t exist or you don&apos;t have access to it.
        </p>
        <Link href="/">
          <Button>Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const openDeleteConfirm = (project: Project) => {
    setPendingProject(project);
    setConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!pendingProject) return;

    try {
      await deleteProjectTrigger({ orgId: orgId, projectId: pendingProject.id });

      toast({
        title: 'Deleted',
        description: `Project "${pendingProject.name}" deleted`,
      });

      setConfirmOpen(false);
      setPendingProject(null);

      if (typeof refetchProjects === 'function') {
        refetchProjects();
      } else {
        // fallback if your hook does not expose refetch/mutate
        window.location.reload();
      }
    } catch (err: any) {
      toast({
        title: 'Delete failed',
        description: err?.message ?? 'Could not delete project',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container mx-auto p-12">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">{organization.name}</h1>
          {organization.description && (
            <p className="text-gray-600 mt-1">{organization.description}</p>
          )}
        </div>
        <PermissionWrapper requiredPermission={'project:create'}>
          <div className="flex gap-2">
            <Button onClick={() => setIsCreateProjectOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4"/>
              New Project
            </Button>
          </div>
        </PermissionWrapper>
      </div>

      <div className="mb-8">
        <h2 className="text-xl font-medium mb-4">Projects</h2>

        {orgId && projects && projects.length > 0 ? (
            <ProjectGrid
              projects={projects}
              isLoading={false}
              onDeleteProject={openDeleteConfirm}
            />
        ) : (
          <div className="border rounded-lg p-8 text-center">
            <h3 className="text-lg font-medium mb-2">No projects yet</h3>
            <p className="text-gray-600 mb-4">
              Create your first project to get started
            </p>
            <Button onClick={() => setIsCreateProjectOpen(true)}>
              <PlusCircle className="mr-2 h-4 w-4"/>
              Create Project
            </Button>
          </div>
        )}
      </div>

      <CreateProjectDialog
        isOpen={isCreateProjectOpen}
        onOpenChange={setIsCreateProjectOpen}
        organizationId={orgId}
        onSuccess={() => window.location.reload()}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isDeleting}
              onClick={() => {
                setConfirmOpen(false);
                setPendingProject(null);
              }}
            >
              Cancel
            </AlertDialogCancel>

            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
