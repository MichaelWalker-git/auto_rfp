'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Briefcase, 
  Building2, 
  Calendar, 
  DollarSign, 
  Star, 
  Users,
  Trash2,
  Plus,
  Edit
} from 'lucide-react';
import { useListPastProjects, useDeletePastProject } from '@/lib/hooks/use-past-performance';
import { DeleteProjectDialog } from './DeleteProjectDialog';
import { useToast } from '@/components/ui/use-toast';
import { ListingPageLayout } from '@/components/layout/ListingPageLayout';
import Link from 'next/link';
import type { PastProject } from '@auto-rfp/core';

interface PastProjectsContentProps {
  orgId: string;
}

export function PastProjectsContent({ orgId }: PastProjectsContentProps) {
  const { projects, isLoading, isError, mutate } = useListPastProjects(orgId);
  const deleteProject = useDeletePastProject();
  const { toast } = useToast();
  
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<PastProject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = (e: React.MouseEvent, project: PastProject) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectToDelete(project);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!projectToDelete) return;
    
    setIsDeleting(true);
    try {
      await deleteProject.trigger({ orgId, projectId: projectToDelete.projectId, hardDelete: false });
      toast({
        title: 'Project Archived',
        description: `"${projectToDelete.title}" has been archived.`,
      });
      mutate();
    } catch (error) {
      console.error('Failed to delete project:', error);
      toast({
        title: 'Error',
        description: 'Failed to archive project. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
    }
  };

  const handleReload = useCallback(async () => {
    await mutate();
  }, [mutate]);

  const formatDate = (date: string | null | undefined) => {
    if (!date) return 'N/A';
    try {
      return new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    } catch {
      return 'N/A';
    }
  };

  const renderProjectItem = (project: PastProject) => (
    <div className="group rounded-xl border bg-background p-4 hover:bg-muted/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
          <Briefcase className="h-5 w-5 text-muted-foreground"/>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link 
              href={`/organizations/${orgId}/past-performance/${project.projectId}/edit`}
              className="font-medium truncate hover:underline"
              title={project.title}
            >
              {project.title}
            </Link>
            {project.performanceRating && (
              <Badge variant="outline" className="flex items-center gap-1 text-xs">
                <Star className="h-3 w-3 text-yellow-500"/>
                {project.performanceRating}/5
              </Badge>
            )}
            {project.domain && (
              <Badge variant="secondary" className="text-xs">{project.domain}</Badge>
            )}
          </div>

          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Building2 className="h-3.5 w-3.5"/>
            <span>{project.client}</span>
            {project.value && (
              <>
                <span className="mx-1">•</span>
                <DollarSign className="h-3.5 w-3.5"/>
                <span>${(project.value / 1000000).toFixed(2)}M</span>
              </>
            )}
            {(project.startDate || project.endDate) && (
              <>
                <span className="mx-1">•</span>
                <Calendar className="h-3.5 w-3.5"/>
                <span>{formatDate(project.startDate)} - {formatDate(project.endDate)}</span>
              </>
            )}
            {project.teamSize && (
              <>
                <span className="mx-1">•</span>
                <Users className="h-3.5 w-3.5"/>
                <span>{project.teamSize}</span>
              </>
            )}
          </div>

          {project.description && (
            <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
              {project.description}
            </p>
          )}

          {/* Technologies */}
          {project.technologies && project.technologies.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {project.technologies.slice(0, 5).map((tech, i) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {tech}
                </Badge>
              ))}
              {project.technologies.length > 5 && (
                <Badge variant="outline" className="text-xs">
                  +{project.technologies.length - 5}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" asChild title="Edit project">
            <Link href={`/organizations/${orgId}/past-performance/${project.projectId}/edit`}>
              <Edit className="h-4 w-4"/>
            </Link>
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={(e) => handleDeleteClick(e, project)} 
            title="Archive project"
          >
            <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive"/>
          </Button>
        </div>
      </div>
    </div>
  );

  const emptyState = (
    <div className="text-center py-10">
      <Briefcase className="mx-auto h-9 w-9 text-muted-foreground mb-3 opacity-50"/>
      <h3 className="text-lg font-medium">No Past Projects Yet</h3>
      <p className="text-muted-foreground mt-1">
        Add your completed projects to enable past performance matching for RFPs.
      </p>
      <Button asChild className="mt-4">
        <Link href={`/organizations/${orgId}/past-performance/new`}>
          <Plus className="h-4 w-4 mr-2"/>
          Add Your First Project
        </Link>
      </Button>
    </div>
  );

  // Calculate stats
  const totalValue = projects.reduce((sum, p) => sum + (p.value || 0), 0);
  const uniqueClients = new Set(projects.map(p => p.client)).size;
  const avgRating = projects.length > 0 && projects.some(p => p.performanceRating)
    ? (projects.reduce((sum, p) => sum + (p.performanceRating || 0), 0) / projects.filter(p => p.performanceRating).length).toFixed(1)
    : null;

  const statsDescription = [
    `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`,
    totalValue > 0 ? `$${(totalValue / 1000000).toFixed(1)}M total value` : null,
    uniqueClients > 0 ? `${uniqueClients} ${uniqueClients === 1 ? 'client' : 'clients'}` : null,
    avgRating ? `${avgRating} avg rating` : null,
  ].filter(Boolean).join(' • ');

  return (
    <div className="container mx-auto p-12">
      <ListingPageLayout
        title="Past Performance"
        description={statsDescription || 'Manage your organization\'s past performance projects for RFP matching'}
        headerActions={
          <Button asChild>
            <Link href={`/organizations/${orgId}/past-performance/new`}>
              <Plus className="h-4 w-4 mr-2"/>
              Add Past Project
            </Link>
          </Button>
        }
        isLoading={isLoading}
        isEmpty={projects.length === 0}
        emptyState={emptyState}
        data={projects}
        renderItem={renderProjectItem}
        onReload={handleReload}
      />
      
      {/* Delete Confirmation Dialog */}
      <DeleteProjectDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        projectTitle={projectToDelete?.title || ''}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </div>
  );
}

export default PastProjectsContent;