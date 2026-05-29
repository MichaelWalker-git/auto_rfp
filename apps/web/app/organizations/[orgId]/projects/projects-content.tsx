'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { CreateProjectDialog } from '@/components/projects/CreateProjectDialog';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/lib/hooks/use-api';
import { useCurrentOrganization } from '@/context/organization-context';
import type { Project } from '@/types/project';
import PermissionWrapper from '@/components/permission-wrapper';
import { PageHeader } from '@/components/layout/page-header';
import { PageSearch } from '@/components/layout/page-search';
import { DeleteProjectDialog } from './components/delete-project-dialog';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface ProjectsPageContentProps {
  orgId: string;
}

// ────────────────────────────────────────────
// Loading fallback
// ────────────────────────────────────────────

function ProjectsListSkeleton() {
  return (
    <div className="container mx-auto p-12">
      <div className="flex justify-between items-center mb-6">
        <Skeleton className="h-9 w-36" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-48 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────
// Main export — wraps data fetching in Suspense
// ────────────────────────────────────────────

export function ProjectsPageContent({ orgId }: ProjectsPageContentProps) {
  return (
    <Suspense fallback={<ProjectsListSkeleton />}>
      <ProjectsList orgId={orgId} />
    </Suspense>
  );
}

// ────────────────────────────────────────────
// Inner component that fetches data
// ────────────────────────────────────────────

function ProjectsList({ orgId }: { orgId: string }) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);

  const router = useRouter();
  const { currentOrganization } = useCurrentOrganization();
  const { data: projects, mutate: refetchProjects } = useProjects(orgId);

  // ── Derived state ──────────────────────────

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    const query = searchQuery.trim().toLowerCase();
    if (!query) return projects as unknown as Project[];
    return (projects as unknown as Project[]).filter(
      (p) => p.name.toLowerCase().includes(query) || (p.description ?? '').toLowerCase().includes(query),
    );
  }, [projects, searchQuery]);

  const hasProjects = Boolean(projects && projects.length > 0);

  // ── Event handlers ─────────────────────────

  const handleOpenDeleteDialog = useCallback((project: Project) => {
    setPendingDeleteProject(project);
    setIsDeleteDialogOpen(true);
  }, []);

  const handleProjectDeleted = useCallback(() => {
    setPendingDeleteProject(null);
    refetchProjects();
  }, [refetchProjects]);

  const handleProjectUpdate = useCallback(() => {
    refetchProjects();
  }, [refetchProjects]);

  const handleCreateSuccess = useCallback(
    (projectId: string) => {
      refetchProjects();
      router.push(`/organizations/${orgId}/projects/${projectId}/dashboard`);
    },
    [refetchProjects, router, orgId],
  );

  // ── Early return ───────────────────────────

  if (!currentOrganization) {
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

  // ── Render ─────────────────────────────────

  return (
    <div className="container mx-auto p-12">
      <PageHeader
        title="Projects"
        description="Manage your RFP projects and proposals"
        actions={
          <>
            <PageSearch value={searchQuery} onChange={setSearchQuery} placeholder="Search projects..." />
            <PermissionWrapper requiredPermission="project:create">
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <PlusCircle className="mr-2 h-4 w-4" />
                New Project
              </Button>
            </PermissionWrapper>
          </>
        }
      />

      <div className="mb-8">
        {hasProjects ? (
          <ProjectGrid
            projects={filteredProjects}
            isLoading={false}
            onDeleteProject={handleOpenDeleteDialog}
            onUpdateProject={handleProjectUpdate}
          />
        ) : (
          <EmptyState onCreateClick={() => setIsCreateDialogOpen(true)} />
        )}
      </div>

      <CreateProjectDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        organizationId={orgId}
        onSuccess={handleCreateSuccess}
      />

      <DeleteProjectDialog
        project={pendingDeleteProject}
        orgId={orgId}
        isOpen={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onDeleted={handleProjectDeleted}
      />
    </div>
  );
}

// ────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className="border rounded-lg p-8 text-center">
      <h3 className="text-lg font-medium mb-2">No projects yet</h3>
      <p className="text-gray-600 mb-4">Create your first project to get started</p>
      <Button onClick={onCreateClick}>
        <PlusCircle className="mr-2 h-4 w-4" />
        Create Project
      </Button>
    </div>
  );
}
