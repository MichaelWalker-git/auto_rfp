'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DOMPurify from 'dompurify';
import type { SamGovDescriptionResponse } from '@/lib/hooks/use-opportunities';

type DescriptionDialogProps = {
  isOpen: boolean;
  title: string;
  description: SamGovDescriptionResponse | null;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DescriptionDialog({
  isOpen,
  title,
  description,
  isLoading,
  onOpenChange,
}: DescriptionDialogProps) {
  const sanitizeHtml = (html: string) => {
    return DOMPurify.sanitize(html);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Opportunity Description for {title}</DialogTitle>
        </DialogHeader>

        {description?.description && (
          <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(description.description) }} />
        )}
        {!description?.description && isLoading && <div>Loading...</div>}
        {!description?.description && !isLoading && <div>No description available</div>}
      </DialogContent>
    </Dialog>
  );
}