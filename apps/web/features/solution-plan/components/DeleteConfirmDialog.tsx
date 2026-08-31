'use client';

import { Trash2 } from 'lucide-react';
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
import { buttonVariants } from '@/components/ui/button';
import type { SolutionPlanVersionListItem } from '@auto-rfp/core';
import { formatVersionTimestamp } from '../lib/version-format';

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The version being deleted — names it in the copy (W6 step 1). */
  version: SolutionPlanVersionListItem | null;
  isDeleting: boolean;
  /** Mapped plain-language failure message — the dialog stays open with it. */
  errorMessage: string | null;
  onConfirm: () => void;
}

/**
 * Destructive delete confirmation (W6): names the version and warns the
 * delete cannot be undone. Initial focus lands on Cancel (Radix AlertDialog
 * default); the destructive action is marked by icon + wording, never color
 * alone. In-flight disables both controls; failures show inline and keep the
 * dialog open (the row stays until the delete succeeds).
 */
export const DeleteConfirmDialog = ({
  open,
  onOpenChange,
  version,
  isDeleting,
  errorMessage,
  onConfirm,
}: DeleteConfirmDialogProps) => {
  const versionName = version
    ? `${formatVersionTimestamp(version.createdAt)}${version.label ? ` — “${version.label}”` : ''}`
    : 'this version';

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isDeleting && onOpenChange(next)}>
      <AlertDialogContent data-testid="delete-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this version?</AlertDialogTitle>
          <AlertDialogDescription>
            The version from {versionName} will be permanently removed from the history. This
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {errorMessage && (
          <p role="alert" className="text-sm text-destructive" data-testid="delete-error">
            {errorMessage}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting} data-testid="delete-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isDeleting}
            className={buttonVariants({ variant: 'destructive' })}
            onClick={(event) => {
              // Keep the dialog open — the container closes it on success.
              event.preventDefault();
              onConfirm();
            }}
            data-testid="delete-confirm"
          >
            <Trash2 className="h-4 w-4" />
            Delete version
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
