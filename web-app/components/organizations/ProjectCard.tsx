'use client';

import React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { FileText } from 'lucide-react';
import { Project } from '@/types/project';

interface ProjectCardProps {
  project: Project;
  orgId: string;
}

export function ProjectCard({ project, orgId }: ProjectCardProps) {
  const status = project.status ?? "In Progress"; // Default status
  
  return (
    <Link href={`/project/${project.id}?orgId=${orgId}`} className="block">
      <Card className="hover:shadow-lg hover:bg-accent/50 transition-all duration-200 cursor-pointer h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 flex-1">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-medium text-lg">{project.name}</h3>
            </div>
            <Badge variant={status === "Completed" ? "default" : "secondary"} className="ml-2">
              {status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground">
            {project.description || 'No description'}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
} 