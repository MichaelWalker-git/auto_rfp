'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useCreateDebriefing } from '@/lib/hooks/use-debriefing';
import type { DebriefingItem } from '@auto-rfp/shared';

interface RequestDebriefingDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  onSuccess?: (debriefing: DebriefingItem) => void;
}

export function RequestDebriefingDialog({
  isOpen,
  onOpenChange,
  projectId,
  orgId,
  onSuccess,
}: RequestDebriefingDialogProps) {
  const [requestDeadline, setRequestDeadline] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { createDebriefing } = useCreateDebriefing();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setIsSubmitting(true);

    try {
      const result = await createDebriefing({
        projectId,
        orgId,
        requestDeadline: requestDeadline || undefined,
      });

      toast({
        title: 'Debriefing Requested',
        description: 'Your debriefing request has been submitted.',
      });

      // Reset form
      setRequestDeadline('');

      onOpenChange(false);
      onSuccess?.(result);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to request debriefing',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Request Debriefing</DialogTitle>
            <DialogDescription>
              Submit a request for a post-award debriefing to learn why your proposal was not selected.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="requestDeadline">Request Deadline (Optional)</Label>
              <Input
                id="requestDeadline"
                type="datetime-local"
                value={requestDeadline}
                onChange={(e) => setRequestDeadline(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                If not provided, the deadline will be set to 3 business days from now.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting...' : 'Request Debriefing'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
