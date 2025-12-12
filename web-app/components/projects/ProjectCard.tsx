import React from 'react';
import Link from 'next/link';
import { Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Project } from '@/types/project';

interface ProjectCardProps {
  project: Project;
  onDelete?: (project: Project) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const status = project.status ?? 'In Progress';

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
      <Link href={`/projects/${project.id}`} className="block">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="text-lg leading-snug truncate">
                {project.name}
              </CardTitle>

              {project.description ? (
                <CardDescription className="mt-1 line-clamp-2">
                  {project.description}
                </CardDescription>
              ) : (
                <CardDescription className="mt-1 text-muted-foreground/70">
                  No description
                </CardDescription>
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
            Created {new Date(project.createdAt).toLocaleDateString()}
          </p>

          {/* Bottom row: delete icon left (hover-only), Open right */}
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              className="
                h-8 w-8 rounded-md
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

            <span className="text-sm text-muted-foreground opacity-0 group-hover:opacity-100 transition">
              Open →
            </span>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}