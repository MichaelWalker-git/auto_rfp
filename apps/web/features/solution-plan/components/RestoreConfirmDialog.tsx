'use client';

import { RotateCcw } from 'lucide-react';
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
import type { SolutionPlanVersionListItem } from '@auto-rfp/core';
import { formatVersionTimestamp } from '../lib/version-format';

interface RestoreConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The version being restored — names it in the copy (W4 step 1). */
  version: SolutionPlanVersionListItem | null;
  isRestoring: boolean;
  /** Mapped plain-language failure message — the dialog stays open with it. */
  errorMessage: string | null;
  onConfirm: () => void;
}

/**
 * Restore confirmation (W4): names the version, explains the current plan is
 * preserved as a version. Initial focus lands on Cancel (Radix AlertDialog
 * default); the primary action is marked by wording + icon, not color alone.
 * While the restore is in flight both controls are disabled; failures show
 * their specific mapped message inline and never close the dialog.
 */
export const RestoreConfirmDialog = ({
  open,
  onOpenChange,
  version,
  isRestoring,
  errorMessage,
  onConfirm,
}: RestoreConfirmDialogProps) => {
  const versionName = version
    ? `${formatVersionTimestamp(version.createdAt)}${version.label ? ` — “${version.label}”` : ''}`
    : 'this version';

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isRestoring && onOpenChange(next)}>
      <AlertDialogContent data-testid="restore-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Restore this version?</AlertDialogTitle>
          <AlertDialogDescription>
            The plan will be set to the content of the version from {versionName}. Your current
            plan is preserved as a version in the history — nothing is lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {errorMessage && (
          <p role="alert" className="text-sm text-destructive" data-testid="restore-error">
            {errorMessage}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isRestoring} data-testid="restore-cancel">
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={isRestoring}
            onClick={(event) => {
              // Keep the dialog open — the container closes it on success.
              event.preventDefault();
              onConfirm();
            }}
            data-testid="restore-confirm"
          >
            <RotateCcw className="h-4 w-4" />
            Restore version
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
