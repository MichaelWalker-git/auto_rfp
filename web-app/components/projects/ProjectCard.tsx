'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

import PermissionWrapper from '@/components/permission-wrapper';
import { useOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import type { Project } from '@/types/project';

interface ProjectCardProps {
  project: Project;
  onDelete?: (project: Project) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const router = useRouter();
  const status = project.status ?? 'In Progress';

  const { currentOrganization } = useOrganization();
  const { setCurrentProject } = useProjectContext();

  const orgId = currentOrganization?.id;

  const href = orgId ? `/organizations/${orgId}/projects/${project.id}` : '#';

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!orgId) return;

    setCurrentProject(project);
    router.push(href);
  };

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
      {/* Use a normal link for accessibility, but intercept to set context first */}
      <Link href={href} className="block" onClick={handleOpen} aria-disabled={!orgId}>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-lg leading-snug truncate">{project.name}</CardTitle>

              {project.description ? (
                <CardDescription className="mt-1 line-clamp-2">{project.description}</CardDescription>
              ) : (
                <CardDescription className="mt-1 text-muted-foreground/70">No description</CardDescription>
              )}
            </div>

            <Badge
              variant={status === 'Completed' ? 'default' : 'secondary'}
              className="shrink-0 whitespace-nowrap"
            >
              {status}
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            Created {project.createdAt ? new Date(project.createdAt).toLocaleDateString() : '—'}
          </p>

          <div className="mt-4 flex items-center justify-between">
            <PermissionWrapper requiredPermission={'project:delete'}>
              <Button
                variant="ghost"
                size="icon"
                className="
                  h-8 w-8 rounded-2xl
                  text-muted-foreground/50
                  hover:text-red-500
                  hover:bg-red-500/10
                  opacity-100 md:opacity-0 md:group-hover:opacity-100
                  transition
                "
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete?.(project);
                }}
                aria-label="Remove project"
                title="Remove project"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </PermissionWrapper>

            <div />

            <span className="text-sm text-muted-foreground opacity-0 group-hover:opacity-100 transition">
              Open →
            </span>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}