'use client';

import { useState } from 'react';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatVersionDate } from '@/lib/hooks/use-document-versions';
import type { RFPDocumentVersion } from '@auto-rfp/core';

interface RevertConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  version: RFPDocumentVersion | null;
  onConfirm: (changeNote?: string) => Promise<void>;
  isLoading?: boolean;
}

export const RevertConfirmDialog = ({
  isOpen,
  onClose,
  version,
  onConfirm,
  isLoading = false,
}: RevertConfirmDialogProps) => {
  const [changeNote, setChangeNote] = useState('');

  const handleConfirm = async () => {
    await onConfirm(changeNote || undefined);
    setChangeNote('');
  };

  const handleClose = () => {
    if (!isLoading) {
      setChangeNote('');
      onClose();
    }
  };

  if (!version) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="h-5 w-5" />
            Revert to Version {version.versionNumber}
          </DialogTitle>
          <DialogDescription>
            This will create a new version with the content from version {version.versionNumber}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                This action cannot be undone
              </p>
              <p className="text-amber-700 dark:text-amber-300">
                The current document will be replaced with the content from{' '}
                <span className="font-medium">
                  v{version.versionNumber}
                </span>{' '}
                ({formatVersionDate(version.createdAt)})
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="changeNote">Change note (optional)</Label>
            <Input
              id="changeNote"
              placeholder="Describe why you're reverting..."
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isLoading}>
            {isLoading ? 'Reverting...' : 'Revert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
