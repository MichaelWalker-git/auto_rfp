'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { useDeleteContentLibraryItem, type ContentLibraryItem } from '@/lib/hooks/use-content-library';

interface DeleteContentDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  item: ContentLibraryItem | null;
  onSuccess?: () => void;
}

export function DeleteContentDialog({
  isOpen,
  onOpenChange,
  item,
  onSuccess,
}: DeleteContentDialogProps) {
  const [hardDelete, setHardDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { toast } = useToast();

  const { deleteItem } = useDeleteContentLibraryItem(
    item?.orgId || '',
    item?.kbId || '',
    item?.id || ''
  );

  const handleDelete = async () => {
    if (!item) return;

    try {
      setIsDeleting(true);
      await deleteItem(hardDelete);
      toast({
        title: 'Success',
        description: hardDelete
          ? 'Content item permanently deleted'
          : 'Content item archived',
      });
      onOpenChange(false);
      setHardDelete(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to delete item',
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!item) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Delete Content Item
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-4">
            <p>
              Are you sure you want to delete this content item?
            </p>
            <div className="bg-muted rounded-lg p-3 text-sm">
              <p className="font-medium text-foreground line-clamp-2">
                {item.question}
              </p>
              <p className="text-muted-foreground mt-1">
                Category: {item.category} | Used {item.usageCount} times
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-center space-x-2 py-4">
          <Checkbox
            id="hard-delete"
            checked={hardDelete}
            onCheckedChange={(checked) => setHardDelete(checked === true)}
          />
          <Label htmlFor="hard-delete" className="text-sm text-muted-foreground">
            Permanently delete (cannot be recovered)
          </Label>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isDeleting
              ? 'Deleting...'
              : hardDelete
              ? 'Delete Permanently'
              : 'Archive'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
