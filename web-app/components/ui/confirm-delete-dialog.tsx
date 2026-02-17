'use client';

import { useCallback, useState } from 'react';
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

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface ConfirmDeleteDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Callback when open state changes */
  onOpenChange: (open: boolean) => void;
  /** The name of the item being deleted (shown in the dialog) */
  itemName?: string;
  /** The type of item being deleted, e.g. "project", "document", "member" */
  itemType?: string;
  /** Custom title override */
  title?: string;
  /** Custom description override */
  description?: string;
  /** Async delete handler — dialog shows loading state while running */
  onConfirm: () => Promise<void> | void;
  /** Text for the confirm button (default: "Delete") */
  confirmLabel?: string;
  /** Text for the cancel button (default: "Cancel") */
  cancelLabel?: string;
  /** Whether the delete is destructive (uses red styling, default: true) */
  isDestructive?: boolean;
}

// ────────────────────────────────────────────
// Component
// ────────────────────────────────────────────

export function ConfirmDeleteDialog({
  isOpen,
  onOpenChange,
  itemName,
  itemType = 'item',
  title,
  description,
  onConfirm,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  isDestructive = true,
}: ConfirmDeleteDialogProps) {
  const [isDeleting, setIsDeleting] = useState(false);

  const resolvedTitle = title ?? (itemName ? `Delete "${itemName}"?` : `Delete ${itemType}?`);
  const resolvedDescription =
    description ?? `This action cannot be undone.${itemName ? ` All ${itemType} data may be removed.` : ''}`;

  const handleConfirm = useCallback(async () => {
    try {
      setIsDeleting(true);
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsDeleting(false);
    }
  }, [onConfirm, onOpenChange]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{resolvedTitle}</AlertDialogTitle>
          <AlertDialogDescription>{resolvedDescription}</AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting} onClick={handleCancel}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isDeleting}
            className={isDestructive ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
          >
            {isDeleting ? 'Deleting...' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ────────────────────────────────────────────
// Hook for imperative usage
// ────────────────────────────────────────────

interface UseConfirmDeleteReturn<T = unknown> {
  /** The item pending deletion (null if dialog is closed) */
  pendingItem: T | null;
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Open the dialog with the given item */
  requestDelete: (item: T) => void;
  /** Close the dialog and reset */
  cancelDelete: () => void;
  /** Props to spread on ConfirmDeleteDialog */
  dialogProps: {
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
  };
}

/**
 * Hook to manage delete confirmation state.
 * 
 * Usage:
 * ```tsx
 * const { requestDelete, pendingItem, dialogProps } = useConfirmDelete<Project>();
 * 
 * return (
 *   <>
 *     <Button onClick={() => requestDelete(project)}>Delete</Button>
 *     <ConfirmDeleteDialog
 *       {...dialogProps}
 *       itemName={pendingItem?.name}
 *       itemType="project"
 *       onConfirm={async () => { await deleteProject(pendingItem!.id); }}
 *     />
 *   </>
 * );
 * ```
 */
export function useConfirmDelete<T = unknown>(): UseConfirmDeleteReturn<T> {
  const [pendingItem, setPendingItem] = useState<T | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const requestDelete = useCallback((item: T) => {
    setPendingItem(item);
    setIsOpen(true);
  }, []);

  const cancelDelete = useCallback(() => {
    setIsOpen(false);
    setPendingItem(null);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setIsOpen(open);
      if (!open) setPendingItem(null);
    },
    [],
  );

  return {
    pendingItem,
    isOpen,
    requestDelete,
    cancelDelete,
    dialogProps: {
      isOpen,
      onOpenChange: handleOpenChange,
    },
  };
}
