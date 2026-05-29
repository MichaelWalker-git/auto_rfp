'use client';

import React from 'react';
import { Project } from '@/types/project';
import { Organization } from '@/types/organization';
import { ProjectCard } from './ProjectCard';
import { EmptyProjectsState } from './EmptyProjectsState';

interface ProjectsListProps {
  projects: Project[];
  organization: Organization | null;
  orgId: string;
  isLoading: boolean;
  onCreateProject: () => void;
}

export function ProjectsList({ 
  projects, 
  organization, 
  orgId, 
  isLoading, 
  onCreateProject 
}: ProjectsListProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-48 rounded-md border border-border animate-pulse bg-muted/20" />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return <EmptyProjectsState onCreateProject={onCreateProject} />;
  }

  return (
    <div className="space-y-4">
      {organization && (
        <div className="border-l-4 border-primary pl-4">
          <h2 className="text-lg font-semibold text-foreground">
            {organization.name}
          </h2>
          <p className="text-sm text-muted-foreground">
            {projects.length} project{projects.length !== 1 ? 's' : ''}
          </p>
        </div>
      )}
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map((project) => (
          <ProjectCard 
            key={project.id}
            project={project}
            orgId={orgId}
          />
        ))}
      </div>
    </div>
  );
} 