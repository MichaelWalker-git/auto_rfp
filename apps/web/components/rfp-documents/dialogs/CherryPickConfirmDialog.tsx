'use client';

import { useState } from 'react';
import { Check, AlertTriangle, ArrowLeft } from 'lucide-react';
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
import { ScrollArea } from '@/components/ui/scroll-area';

interface CherryPickConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  sourceVersion: number;
  previewHtml: string;
  onConfirm: (changeNote?: string) => Promise<void>;
  isLoading?: boolean;
  onGoBack?: () => void;
}

export const CherryPickConfirmDialog = ({
  isOpen,
  onClose,
  selectedCount,
  sourceVersion,
  previewHtml,
  onConfirm,
  isLoading = false,
  onGoBack,
}: CherryPickConfirmDialogProps) => {
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5" />
            Apply {selectedCount} Change{selectedCount !== 1 ? 's' : ''}
          </DialogTitle>
          <DialogDescription>
            Cherry-picking {selectedCount} change{selectedCount !== 1 ? 's' : ''} from version {sourceVersion}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">
                Review the changes before applying
              </p>
              <p className="text-amber-700 dark:text-amber-300">
                A new version will be created with the selected changes merged into the current document.
              </p>
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <Label>Preview of merged content</Label>
            <ScrollArea className="h-48 border rounded-md">
              <div
                className="p-4 prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </ScrollArea>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cherryPickNote">Change note (optional)</Label>
            <Input
              id="cherryPickNote"
              placeholder="Describe the changes you're applying..."
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <div className="flex gap-2 w-full sm:w-auto">
            {onGoBack && (
              <Button 
                variant="outline" 
                onClick={() => {
                  setChangeNote('');
                  onGoBack();
                }} 
                disabled={isLoading}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Selection
              </Button>
            )}
            <Button variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancel
            </Button>
          </div>
          <Button onClick={handleConfirm} disabled={isLoading} className="sm:ml-auto">
            {isLoading ? 'Applying...' : `Apply ${selectedCount} Change${selectedCount !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
