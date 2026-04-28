'use client';

import React, { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { OpportunityItem } from '@auto-rfp/core';
import type { EditFormValues } from './useOpportunityHeaderActions';

const EditFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional(),
  organizationName: z.string().trim().optional(),
  type: z.string().trim().optional(),
  setAside: z.string().trim().optional(),
  naicsCode: z.string().trim().optional(),
  pscCode: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.string().trim().email('Invalid email').optional().or(z.literal('')),
});

interface OpportunityHeaderEditProps {
  opportunity: OpportunityItem;
  onSubmit: (values: EditFormValues) => Promise<void>;
  submitError: string | null;
  onClearError: () => void;
}

export const OpportunityHeaderEdit = ({
  opportunity,
  onSubmit,
  submitError,
  onClearError,
}: OpportunityHeaderEditProps) => {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditFormValues>({
    resolver: zodResolver(EditFormSchema),
  });

  useEffect(() => {
    reset({
      title: opportunity.title,
      description: opportunity.description || '',
      organizationName: opportunity.organizationName || '',
      type: opportunity.type || '',
      setAside: opportunity.setAside || '',
      naicsCode: opportunity.naicsCode || '',
      pscCode: opportunity.pscCode || '',
      contactName: opportunity.contactName || '',
      contactEmail: opportunity.contactEmail || '',
    });
    onClearError();
  }, [opportunity, reset, onClearError]);

  return (
    <form id="opp-edit-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="opp-title">Title *</Label>
        <Input id="opp-title" placeholder="Opportunity title" autoFocus {...register('title')} />
        {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="opp-org">Organization</Label>
        <Input id="opp-org" placeholder="Organization name" {...register('organizationName')} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="opp-contact-name">Contact Name</Label>
          <Input id="opp-contact-name" placeholder="Point of contact" {...register('contactName')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="opp-contact-email">Contact Email</Label>
          <Input id="opp-contact-email" type="email" placeholder="contact@agency.gov" {...register('contactEmail')} />
          {errors.contactEmail && <p className="text-xs text-destructive">{errors.contactEmail.message}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="opp-type">Type</Label>
          <Input id="opp-type" placeholder="e.g., Solicitation" {...register('type')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="opp-setaside">Set-Aside</Label>
          <Input id="opp-setaside" placeholder="e.g., 8(a)" {...register('setAside')} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="opp-naics">NAICS Code</Label>
          <Input id="opp-naics" placeholder="e.g., 541512" {...register('naicsCode')} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="opp-psc">PSC Code</Label>
          <Input id="opp-psc" placeholder="e.g., D302" {...register('pscCode')} />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="opp-desc">Description</Label>
        <Textarea id="opp-desc" placeholder="Opportunity description" rows={3} {...register('description')} />
      </div>

      {submitError && (
        <Alert variant="destructive">
          <AlertDescription>{submitError}</AlertDescription>
        </Alert>
      )}
    </form>
  );
};
