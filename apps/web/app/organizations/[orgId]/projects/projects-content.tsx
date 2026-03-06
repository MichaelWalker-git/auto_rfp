'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

import { ProjectGrid } from '@/components/projects/ProjectGrid';
import { ProjectCardSkeleton } from '@/components/projects/ProjectCardSkeleton';
import { Button } from '@/components/ui/button';
import { useProjects } from '@/lib/hooks/use-api';
import { useCurrentOrganization } from '@/context/organization-context';
import type { Project } from '@/types/project';
import PermissionWrapper from '@/components/permission-wrapper';
import { PageHeader } from '@/components/layout/page-header';
import { PageSearch } from '@/components/layout/page-search';
import { DeleteProjectDialog } from './components/delete-project-dialog';
import { useFavoriteProjects } from '@/lib/hooks/use-favorite-projects';

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
      {/* Header skeleton — matches PageHeader layout */}
      <div className="flex items-start justify-between gap-4 mb-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-48 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>
      {/* Project cards skeleton — matches ProjectCardSkeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <ProjectCardSkeleton key={i} />
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
  const [searchQuery, setSearchQuery] = useState('');
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<Project | null>(null);

  const router = useRouter();
  const { currentOrganization } = useCurrentOrganization();
  const { data: projects, mutate: refetchProjects } = useProjects(orgId);
  const { isFavorite } = useFavoriteProjects();

  // ── Derived state ──────────────────────────

  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    const query = searchQuery.trim().toLowerCase();

    // Filter projects based on search query
    let filtered = projects as unknown as Project[];
    if (query) {
      filtered = filtered.filter(
        (p) => p.name.toLowerCase().includes(query) || (p.description ?? '').toLowerCase().includes(query),
      );
    }

    // Sort: favorites first, then by creation date (newest first)
    return filtered.sort((a, b) => {
      const aIsFav = isFavorite(a.id);
      const bIsFav = isFavorite(b.id);

      // If one is favorite and the other isn't, favorite comes first
      if (aIsFav && !bIsFav) return -1;
      if (!aIsFav && bIsFav) return 1;

      // If both have the same favorite status, sort by creation date
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [projects, searchQuery, isFavorite]);

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

  const handleCreateClick = () => {
    router.push(`/organizations/${orgId}/projects/create`);
  };

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
              <Button onClick={handleCreateClick}>
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
          <EmptyState onCreateClick={handleCreateClick} />
        )}
      </div>

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
