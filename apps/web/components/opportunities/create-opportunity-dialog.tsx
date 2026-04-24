'use client';

import React, { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format } from 'date-fns';
import type { OpportunityItem } from '@auto-rfp/core';
import { CalendarIcon, Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useCreateOpportunity } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';

// ─── Form schema ──────────────────────────────────────────────────────────────

const CreateOpportunityFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  solicitationNumber: z.string().trim().optional(),
  description: z.string().trim().optional(),
  organizationName: z.string().trim().optional(),
  type: z.string().trim().optional(),
  setAside: z.string().trim().optional(),
  naicsCode: z.string().trim().optional(),
  pscCode: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.string().trim().email('Invalid email').optional().or(z.literal('')),
});

type CreateOpportunityFormValues = z.input<typeof CreateOpportunityFormSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface CreateOpportunityDialogProps {
  projectId?: string;
  onCreated?: (item: OpportunityItem) => void;
  trigger?: React.ReactNode;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateOpportunityDialog({ projectId: propProjectId, onCreated, trigger }: CreateOpportunityDialogProps) {
  const { currentOrganization } = useCurrentOrganization();
  const params = useParams();
  const { trigger: createOpportunity, isMutating: isCreating } = useCreateOpportunity();

  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [deadlineDate, setDeadlineDate] = useState<Date | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const projectId = propProjectId || (params?.projectId as string);
  const orgId = currentOrganization?.id;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateOpportunityFormValues>({
    resolver: zodResolver(CreateOpportunityFormSchema),
    defaultValues: {
      title: '',
      solicitationNumber: '',
      description: '',
      organizationName: '',
      type: '',
      setAside: '',
      naicsCode: '',
      pscCode: '',
      contactName: '',
      contactEmail: '',
    },
  });

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen) {
      reset();
      setSubmitError(null);
      setDeadlineDate(undefined);
    }
    setOpen(newOpen);
  }, [reset]);

  const onSubmit = useCallback(async (values: CreateOpportunityFormValues) => {
    setSubmitError(null);

    if (!projectId) {
      setSubmitError('Missing projectId');
      return;
    }

    const uniqueId = values.solicitationNumber?.trim() || `manual-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
      const opportunityData: OpportunityItem = {
        orgId: orgId || undefined,
        projectId,
        source: 'MANUAL_UPLOAD',
        id: uniqueId,
        title: values.title,
        type: values.type?.trim() || null,
        postedDateIso: new Date().toISOString(),
        responseDeadlineIso: deadlineDate ? deadlineDate.toISOString() : null,
        noticeId: null,
        solicitationNumber: values.solicitationNumber?.trim() || null,
        naicsCode: values.naicsCode?.trim() || null,
        pscCode: values.pscCode?.trim() || null,
        organizationName: values.organizationName?.trim() || null,
        setAside: values.setAside?.trim() || null,
        description: values.description?.trim() || null,
        contactName: values.contactName?.trim() || null,
        contactEmail: values.contactEmail?.trim() || null,
        stage: 'IDENTIFIED',
        baseAndAllOptionsValue: null,
      };

      const result = await createOpportunity(opportunityData);
      setOpen(false);
      onCreated?.(result.item);
    } catch (err: unknown) {
      setSubmitError((err as Error)?.message || 'Failed to create opportunity');
    }
  }, [projectId, orgId, deadlineDate, createOpportunity, onCreated]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" className="gap-1.5">
            <Plus className="h-4 w-4" />
            Create Opportunity
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Create Opportunity</DialogTitle>
            <DialogDescription>
              Manually create a new opportunity for this project.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Title *</Label>
              <Input id="title" placeholder="Opportunity title" {...register('title')} />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="solicitationNumber">Solicitation Number</Label>
              <Input id="solicitationNumber" placeholder="e.g., FA8532-24-R-0001" {...register('solicitationNumber')} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" placeholder="Opportunity description" rows={3} {...register('description')} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="organizationName">Organization</Label>
              <Input id="organizationName" placeholder="Contracting organization name" {...register('organizationName')} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contactName">Contact Name</Label>
                <Input id="contactName" placeholder="Point of contact" {...register('contactName')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="contactEmail">Contact Email</Label>
                <Input id="contactEmail" type="email" placeholder="contact@agency.gov" {...register('contactEmail')} />
                {errors.contactEmail && <p className="text-xs text-destructive">{errors.contactEmail.message}</p>}
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Response Deadline</Label>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className={cn(
                      'w-full justify-start text-left font-normal h-9 text-sm',
                      !deadlineDate && 'text-muted-foreground',
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
                      setCalendarOpen(false);
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="type">Type</Label>
                <Input id="type" placeholder="e.g., Solicitation" {...register('type')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="setAside">Set-Aside</Label>
                <Input id="setAside" placeholder="e.g., 8(a)" {...register('setAside')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="naicsCode">NAICS Code</Label>
                <Input id="naicsCode" placeholder="e.g., 541512" {...register('naicsCode')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pscCode">PSC Code</Label>
                <Input id="pscCode" placeholder="e.g., D302" {...register('pscCode')} />
              </div>
            </div>
          </div>

          {submitError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Opportunity'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
