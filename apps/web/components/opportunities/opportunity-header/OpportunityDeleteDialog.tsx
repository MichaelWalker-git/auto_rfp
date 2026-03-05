'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface OpportunityDeleteDialogProps {
  open: boolean;
  opportunityTitle: string | undefined;
  isDeleting: boolean;
  deleteError: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onClearError: () => void;
}

export const OpportunityDeleteDialog = ({
  open,
  opportunityTitle,
  isDeleting,
  deleteError,
  onConfirm,
  onCancel,
  onClearError,
}: OpportunityDeleteDialogProps) => {
  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onCancel();
      onClearError();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Delete Opportunity</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{' '}
            <span className="font-semibold text-foreground">"{opportunityTitle}"</span>?
            This will also delete all associated question files and cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {deleteError && (
          <Alert variant="destructive">
            <AlertDescription>{deleteError}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Deleting...
              </>
            ) : (
              'Delete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
