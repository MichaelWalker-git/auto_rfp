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
  const [contactEmail, setContactEmail] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { createDebriefing } = useCreateDebriefing();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!contactEmail) {
      toast({
        title: 'Error',
        description: 'Contact email is required',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createDebriefing({
        projectId,
        orgId,
        contactEmail,
        contactName: contactName || undefined,
        contactPhone: contactPhone || undefined,
        notes: notes || undefined,
      });

      toast({
        title: 'Debriefing Requested',
        description: 'Your debriefing request has been submitted.',
      });

      // Reset form
      setContactEmail('');
      setContactName('');
      setContactPhone('');
      setNotes('');

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
              <Label htmlFor="contactEmail">Contracting Officer Email *</Label>
              <Input
                id="contactEmail"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="co@agency.gov"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="contactName">Contracting Officer Name</Label>
              <Input
                id="contactName"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="John Smith"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="contactPhone">Phone Number</Label>
              <Input
                id="contactPhone"
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="(555) 123-4567"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes for the debriefing request..."
                rows={3}
              />
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
