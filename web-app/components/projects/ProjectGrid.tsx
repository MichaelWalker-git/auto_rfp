import React from "react";
import { ProjectCard } from "./ProjectCard";
import { ProjectCardSkeleton } from "./ProjectCardSkeleton";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Project } from "@/types/project";

interface ProjectGridProps {
  projects: Project[];
  isLoading: boolean;
  showCreateCard?: boolean;
}

export function ProjectGrid({ projects, isLoading, showCreateCard = true }: ProjectGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3  gap-4">
        {[1, 2, 3].map((i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <Card className="text-center p-8">
        <CardContent>
          <p className="mb-4 text-muted-foreground">No projects found</p>
          <Link href="/projects">
            <Button>Create Your First Project</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
} 