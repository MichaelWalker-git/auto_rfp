'use client';

import React from 'react';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Project } from '@/types/project';

interface ProjectCardProps {
  project: Project;
  orgId: string;
}

export function ProjectCard({ project, orgId }: ProjectCardProps) {
  return (
    <Link href={`/organizations/${orgId}/projects/${project.id}`} className="block">
      <Card className="group overflow-hidden transition-all duration-200 hover:shadow-md hover:border-primary/20 flex flex-col h-full bg-gradient-to-br from-background to-muted/30">
        <CardHeader className="pb-2 pt-4 px-4 flex-1 flex flex-col">
          <div className="mb-3">
            <CardTitle className="text-base font-semibold leading-tight line-clamp-3 text-foreground/90">{project.name}</CardTitle>
          </div>

          <div className="flex-1 min-h-0 mb-2">
            {project.description ? (
              <CardDescription className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{project.description}</CardDescription>
            ) : (
              <CardDescription className="text-xs text-muted-foreground/50 italic">No description</CardDescription>
            )}
          </div>
        </CardHeader>

        <CardContent className="px-4 py-3 mt-auto border-t border-border/50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground/70">
              {project.createdAt ? new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
