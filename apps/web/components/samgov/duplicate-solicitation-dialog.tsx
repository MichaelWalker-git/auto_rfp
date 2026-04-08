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
import type { DuplicateInfo } from '@/lib/hooks/use-import-solicitation';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  duplicate: DuplicateInfo | null;
  onConfirm: () => void;
};

export const DuplicateSolicitationDialog = ({
  open,
  onOpenChange,
  duplicate,
  onConfirm,
}: Props) => {
  const identifier = duplicate?.noticeId ?? duplicate?.solicitationNumber ?? '';
  const importedDate = duplicate?.importedAt
    ? new Date(duplicate.importedAt).toLocaleDateString()
    : null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Solicitation already imported</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                This solicitation (<span className="font-mono font-medium">{identifier}</span>) has already been imported for your organization.
              </p>
              {duplicate && (
                <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
                  <div><span className="text-muted-foreground">Title:</span> {duplicate.title}</div>
                  {duplicate.projectName && (
                    <div><span className="text-muted-foreground">Project:</span> {duplicate.projectName}</div>
                  )}
                  {duplicate.importedBy && (
                    <div><span className="text-muted-foreground">Imported by:</span> {duplicate.importedBy}</div>
                  )}
                  {importedDate && (
                    <div><span className="text-muted-foreground">Imported:</span> {importedDate}</div>
                  )}
                </div>
              )}
              <p>Do you want to import it again? This will create a duplicate opportunity.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Import anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};