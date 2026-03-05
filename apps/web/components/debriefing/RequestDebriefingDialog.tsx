'use client';

import React, { useState } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
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
import { Calendar } from '@/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useCreateDebriefing } from '@/lib/hooks/use-debriefing';
import type { DebriefingItem } from '@auto-rfp/core';

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
  const [deadlineDate, setDeadlineDate] = useState<Date | undefined>(undefined);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
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
        requestDeadline: deadlineDate ? deadlineDate.toISOString() : undefined,
      });

      toast({
        title: 'Debriefing Requested',
        description: 'Your debriefing request has been submitted.',
      });

      // Reset form
      setDeadlineDate(undefined);

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
              <Label>Request Deadline (Optional)</Label>
              <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal h-9 text-sm',
                      !deadlineDate && 'text-muted-foreground'
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {deadlineDate ? format(deadlineDate, 'PPP') : 'Pick a date'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={deadlineDate}
                    onSelect={(date) => {
                      setDeadlineDate(date);
                      setIsCalendarOpen(false);
                    }}
                    disabled={(date) => date < new Date()}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <p className="text-xs text-muted-foreground">
                If not provided, the deadline will be set to 3 business days from now (per FAR 15.506).
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
