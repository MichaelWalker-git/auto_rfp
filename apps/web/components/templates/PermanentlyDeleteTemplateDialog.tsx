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

interface PermanentlyDeleteTemplateDialogProps {
  template: TemplateItem | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export const PermanentlyDeleteTemplateDialog = ({
  template,
  onConfirm,
  onCancel,
}: PermanentlyDeleteTemplateDialogProps) => {
  return (
    <AlertDialog open={!!template} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Permanently Delete Template</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. The template &quot;{template?.name}&quot; and
            all its version history will be permanently removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete Forever
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
