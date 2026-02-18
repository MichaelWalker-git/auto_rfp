'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { TemplateItem } from '@/lib/hooks/use-templates';

interface DeleteTemplateDialogProps {
  template: TemplateItem | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteTemplateDialog({
  template,
  onConfirm,
  onCancel,
}: DeleteTemplateDialogProps) {
  return (
    <AlertDialog open={!!template} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive Template</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to archive &quot;{template?.name}&quot;? This template
            will no longer be available for use but can be restored later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}