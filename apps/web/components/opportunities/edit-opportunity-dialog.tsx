'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { OpportunityItem, OpportunityStage } from '@auto-rfp/core';
import {
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGE_COLORS,
  ACTIVE_OPPORTUNITY_STAGES,
  TERMINAL_OPPORTUNITY_STAGES,
} from '@auto-rfp/core';
import { Loader2, Pencil } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useUpdateOpportunity } from '@/lib/hooks/use-opportunities';
import { useCurrentOrganization } from '@/context/organization-context';
import { updateOpportunityStageApi } from '@/lib/hooks/use-opportunity-stage';

// ─── Form schema ──────────────────────────────────────────────────────────────

const EditOpportunityFormSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  description: z.string().trim().optional(),
  organizationName: z.string().trim().optional(),
  type: z.string().trim().optional(),
  setAside: z.string().trim().optional(),
  naicsCode: z.string().trim().optional(),
  pscCode: z.string().trim().optional(),
  stage: z.enum([
    'IDENTIFIED', 'QUALIFYING', 'PURSUING', 'SUBMITTED',
    'WON', 'LOST', 'NO_BID', 'WITHDRAWN',
  ]),
});

type EditOpportunityFormValues = z.input<typeof EditOpportunityFormSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface EditOpportunityDialogProps {
  item: OpportunityItem;
  onUpdated?: (item: OpportunityItem) => void;
  trigger?: React.ReactNode;
}

const STAGE_ORDER: OpportunityStage[] = [
  'IDENTIFIED', 'QUALIFYING', 'PURSUING', 'SUBMITTED',
  'WON', 'LOST', 'NO_BID', 'WITHDRAWN',
];

// ─── Component ────────────────────────────────────────────────────────────────

export function EditOpportunityDialog({ item, onUpdated, trigger }: EditOpportunityDialogProps) {
  const { currentOrganization } = useCurrentOrganization();
  const params = useParams();
  const { trigger: updateOpportunity, isMutating: isUpdating } = useUpdateOpportunity(currentOrganization?.id);

  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const oppId = item.oppId ?? item.id;
  const projectId = (params?.projectId as string) || item.projectId;
  const orgId = currentOrganization?.id;

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<EditOpportunityFormValues>({
    resolver: zodResolver(EditOpportunityFormSchema),
  });

  // Reset form with current item values when dialog opens
  useEffect(() => {
    if (open) {
      reset({
        title: item.title,
        description: item.description || '',
        organizationName: item.organizationName || '',
        type: item.type || '',
        setAside: item.setAside || '',
        naicsCode: item.naicsCode || '',
        pscCode: item.pscCode || '',
        stage: (item.stage as OpportunityStage | undefined) ?? 'IDENTIFIED',
      });
      setSubmitError(null);
    }
  }, [open, item, reset]);

  const onSubmit = useCallback(async (values: EditOpportunityFormValues) => {
    setSubmitError(null);

    if (!oppId || !projectId) {
      setSubmitError('Missing projectId or oppId');
      return;
    }

    try {
      const result = await updateOpportunity({
        projectId,
        oppId,
        patch: {
          title: values.title,
          description: values.description?.trim() || null,
          type: values.type?.trim() || null,
          setAside: values.setAside?.trim() || null,
          naicsCode: values.naicsCode?.trim() || null,
          pscCode: values.pscCode?.trim() || null,
          organizationName: values.organizationName?.trim() || null,
        },
      });

      // Update stage separately if it changed
      const currentStage = (item.stage as OpportunityStage | undefined) ?? 'IDENTIFIED';
      if (values.stage !== currentStage && orgId) {
        await updateOpportunityStageApi(orgId, { projectId, oppId, stage: values.stage });
      }

      setOpen(false);
      onUpdated?.({ ...result.item, stage: values.stage });
    } catch (err: unknown) {
      setSubmitError((err as Error)?.message || 'Failed to update opportunity');
    }
  }, [oppId, projectId, orgId, item.stage, updateOpportunity, onUpdated]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline" className="gap-1.5">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Edit Opportunity</DialogTitle>
            <DialogDescription>Update the opportunity details below.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            {/* Title */}
            <div className="grid gap-2">
              <Label htmlFor="edit-title">Title *</Label>
              <Input id="edit-title" placeholder="Opportunity title" {...register('title')} />
              {errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea id="edit-description" placeholder="Opportunity description" rows={3} {...register('description')} />
            </div>

            {/* Organization */}
            <div className="grid gap-2">
              <Label htmlFor="edit-org">Organization</Label>
              <Input id="edit-org" placeholder="Organization name" {...register('organizationName')} />
            </div>

            {/* Type + Set-Aside */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-type">Type</Label>
                <Input id="edit-type" placeholder="e.g., Solicitation" {...register('type')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-setaside">Set-Aside</Label>
                <Input id="edit-setaside" placeholder="e.g., 8(a)" {...register('setAside')} />
              </div>
            </div>

            {/* NAICS + PSC */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="edit-naics">NAICS Code</Label>
                <Input id="edit-naics" placeholder="e.g., 541512" {...register('naicsCode')} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-psc">PSC Code</Label>
                <Input id="edit-psc" placeholder="e.g., D302" {...register('pscCode')} />
              </div>
            </div>

            {/* Pipeline Stage */}
            <div className="grid gap-2">
              <Label htmlFor="edit-stage">Pipeline Stage</Label>
              <Controller
                name="stage"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="edit-stage" className="w-full">
                      <SelectValue>
                        {field.value && (
                          <span className="flex items-center gap-2">
                            <Badge
                              variant="outline"
                              className={cn('text-xs h-5 px-1.5 font-medium border', OPPORTUNITY_STAGE_COLORS[field.value as OpportunityStage])}
                            >
                              {OPPORTUNITY_STAGE_LABELS[field.value as OpportunityStage]}
                            </Badge>
                          </span>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel className="text-xs text-muted-foreground">Active</SelectLabel>
                        {STAGE_ORDER.filter(s => ACTIVE_OPPORTUNITY_STAGES.includes(s)).map(s => (
                          <SelectItem key={s} value={s}>
                            <span className="flex items-center gap-2">
                              <Badge variant="outline" className={cn('text-xs h-5 px-1.5 font-medium border', OPPORTUNITY_STAGE_COLORS[s])}>
                                {OPPORTUNITY_STAGE_LABELS[s]}
                              </Badge>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel className="text-xs text-muted-foreground">Terminal</SelectLabel>
                        {STAGE_ORDER.filter(s => TERMINAL_OPPORTUNITY_STAGES.includes(s)).map(s => (
                          <SelectItem key={s} value={s}>
                            <span className="flex items-center gap-2">
                              <Badge variant="outline" className={cn('text-xs h-5 px-1.5 font-medium border', OPPORTUNITY_STAGE_COLORS[s])}>
                                {OPPORTUNITY_STAGE_LABELS[s]}
                              </Badge>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              <p className="text-xs text-muted-foreground">
                Stage is also updated automatically based on brief scoring and project outcomes.
              </p>
            </div>
          </div>

          {submitError && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isUpdating}>
              Cancel
            </Button>
            <Button type="submit" disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
