'use client';

import React, { useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { OpportunityItem } from '@auto-rfp/core';
import { Loader2, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useCreateOpportunity } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';
import { useState } from 'react';

// ─── Form schema ──────────────────────────────────────────────────────────────

const CreateOpportunityFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  solicitationNumber: z.string().trim().optional(),
  description: z.string().trim().optional(),
  organizationName: z.string().trim().optional(),
  responseDeadline: z.string().optional(),
  type: z.string().trim().optional(),
  setAside: z.string().trim().optional(),
  naicsCode: z.string().trim().optional(),
  pscCode: z.string().trim().optional(),
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
      responseDeadline: '',
      type: '',
      setAside: '',
      naicsCode: '',
      pscCode: '',
    },
  });

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen) {
      reset();
      setSubmitError(null);
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
        responseDeadlineIso: values.responseDeadline ? new Date(values.responseDeadline).toISOString() : null,
        noticeId: null,
        solicitationNumber: values.solicitationNumber?.trim() || null,
        naicsCode: values.naicsCode?.trim() || null,
        pscCode: values.pscCode?.trim() || null,
        organizationName: values.organizationName?.trim() || null,
        setAside: values.setAside?.trim() || null,
        description: values.description?.trim() || null,
        stage: 'IDENTIFIED',
        baseAndAllOptionsValue: null,
      };

      const result = await createOpportunity(opportunityData);
      setOpen(false);
      onCreated?.(result.item);
    } catch (err: unknown) {
      setSubmitError((err as Error)?.message || 'Failed to create opportunity');
    }
  }, [projectId, orgId, createOpportunity, onCreated]);

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

            <div className="grid gap-2">
              <Label htmlFor="responseDeadline">Response Deadline</Label>
              <Input id="responseDeadline" type="datetime-local" {...register('responseDeadline')} />
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
