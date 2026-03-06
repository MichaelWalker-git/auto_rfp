'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { BaseCard } from '@/components/ui/base-card';
import { useCurrentOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import type { Project } from '@/types/project';
import PermissionWrapper from '../permission-wrapper';
import { useFavoriteProjects } from '@/lib/hooks/use-favorite-projects';

interface ProjectCardProps {
  project: Project;
  onDelete?: (project: Project) => void;
  onUpdate?: (updatedProject: Project) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const router = useRouter();

  const { currentOrganization } = useCurrentOrganization();
  const { setCurrentProject } = useProjectContext();
  const { isFavorite, toggleFavorite } = useFavoriteProjects();

  const orgId = currentOrganization?.id;
  const isFav = isFavorite(project.id);

  const href = orgId ? `/organizations/${orgId}/projects/${project.id}` : '#';

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!orgId) return;

    setCurrentProject(project);
    router.push(href);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (orgId) {
      router.push(`/organizations/${orgId}/projects/${project.id}/edit`);
    }
  };

  const handleToggleFavorite = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFavorite(project.id);
  };

  return (
    <>
      <Link href={href} className="block" onClick={handleOpen} aria-disabled={!orgId}>
        <BaseCard
          title={project.name}
          subtitle={project.description}
          isHoverable
          actions={
            <>
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xl"
                onClick={handleToggleFavorite}
                aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                title={isFav ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star
                  className={`h-3.5 w-3.5 ${isFav ? 'fill-yellow-400 text-yellow-400' : ''}`}
                />
              </Button>

              <PermissionWrapper requiredPermission={'project:edit'}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl"
                  onClick={handleEditClick}
                  aria-label="Edit project"
                  title="Edit project"
                >
                  <Pencil className="h-3.5 w-3.5"/>
                </Button>
              </PermissionWrapper>

              <PermissionWrapper requiredPermission={'project:delete'}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete?.(project);
                  }}
                  aria-label="Remove project"
                  title="Remove project"
                >
                  <Trash2 className="h-3.5 w-3.5"/>
                </Button>
              </PermissionWrapper>
            </>
          }
          footer={
            <p className="text-xs text-muted-foreground/70">
              {project.createdAt ? new Date(project.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric'
              }) : '—'}
            </p>
          }
        />
      </Link>
    </>
  );
}