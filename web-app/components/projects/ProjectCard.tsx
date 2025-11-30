import React from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Project } from "@/types/project";

interface ProjectCardProps {
  project: Project;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const status = project.status ?? "In Progress"; // Default status
  
  return (
    <Link href={`/projects/${project.id}`} className="block">
      <Card className="hover:shadow-lg hover:bg-accent/50 transition-all duration-200 cursor-pointer flex flex-col h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle className="text-lg">{project.name}</CardTitle>
              {project.description && (
                <CardDescription className="mt-1">{project.description}</CardDescription>
              )}
            </div>
            <Badge variant={status === "Completed" ? "default" : "secondary"} className="ml-2">
              {status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex-grow">
          <p className="text-sm text-muted-foreground">
            Created {new Date(project.createdAt).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
} 