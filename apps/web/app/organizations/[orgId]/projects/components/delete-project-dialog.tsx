'use client';

import { useCallback } from 'react';
import { useToast } from '@/components/ui/use-toast';
import { useDeleteProject } from '@/lib/hooks/use-project';
import type { Project } from '@/types/project';
import { ConfirmDeleteDialog } from '@/components/ui/confirm-delete-dialog';

interface DeleteProjectDialogProps {
  project: Project | null;
  orgId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function DeleteProjectDialog({
  project,
  orgId,
  isOpen,
  onOpenChange,
  onDeleted,
}: DeleteProjectDialogProps) {
  const { toast } = useToast();
  const { trigger: deleteProjectTrigger } = useDeleteProject();

  const handleConfirm = useCallback(async () => {
    if (!project) return;

    try {
      await deleteProjectTrigger({ orgId, projectId: project.id });
      toast({ title: 'Deleted', description: `Project "${project.name}" deleted` });
      onDeleted();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not delete project';
      toast({ title: 'Delete failed', description: message, variant: 'destructive' });
      throw err; // re-throw so ConfirmDeleteDialog doesn't auto-close
    }
  }, [project, deleteProjectTrigger, orgId, toast, onDeleted]);

  return (
    <ConfirmDeleteDialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      itemName={project?.name}
      itemType="project"
      onConfirm={handleConfirm}
    />
  );
}
