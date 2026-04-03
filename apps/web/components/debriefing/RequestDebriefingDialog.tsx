'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
import { useToast } from '@/components/ui/use-toast';
import { useCreateDebriefing, useUpdateDebriefing } from '@/lib/hooks/use-debriefing';
import { CreateDebriefingRequestSchema } from '@auto-rfp/core';
import type { DebriefingItem } from '@auto-rfp/core';
import { z } from 'zod';

type CreateDebriefingFormValues = z.input<typeof CreateDebriefingRequestSchema>;

interface RequestDebriefingDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  opportunityId: string;
  /** Pre-populate from opportunity data */
  solicitationNumber?: string;
  contractTitle?: string;
  onSuccess?: (debriefing: DebriefingItem) => void;
  /** When provided, dialog operates in edit mode */
  existingDebriefing?: DebriefingItem;
}

export const RequestDebriefingDialog = ({
  isOpen,
  onOpenChange,
  projectId,
  orgId,
  opportunityId,
  solicitationNumber: initialSolicitationNumber = '',
  contractTitle: initialContractTitle = '',
  onSuccess,
  existingDebriefing,
}: RequestDebriefingDialogProps) => {
  const { toast } = useToast();
  const { createDebriefing } = useCreateDebriefing();
  const { updateDebriefing } = useUpdateDebriefing();
  const isEditMode = !!existingDebriefing;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateDebriefingFormValues>({
    resolver: zodResolver(CreateDebriefingRequestSchema),
    defaultValues: {
      projectId,
      orgId,
      opportunityId,
      solicitationNumber: existingDebriefing?.solicitationNumber ?? initialSolicitationNumber,
      contractTitle: existingDebriefing?.contractTitle ?? initialContractTitle,

      awardedOrganization: existingDebriefing?.awardedOrganization ?? '',
      awardNotificationDate: existingDebriefing?.awardNotificationDate ?? '',
      contractingOfficerEmail: existingDebriefing?.contractingOfficerEmail ?? '',
      requesterName: existingDebriefing?.requesterName ?? '',
      requesterTitle: existingDebriefing?.requesterTitle ?? '',
      requesterEmail: existingDebriefing?.requesterEmail ?? '',
      requesterPhone: existingDebriefing?.requesterPhone ?? '',
      requesterAddress: existingDebriefing?.requesterAddress ?? '',
      companyName: existingDebriefing?.companyName ?? '',
    },
  });

  const onSubmit = async (values: CreateDebriefingFormValues) => {
    try {
      const parsed = CreateDebriefingRequestSchema.parse(values);

      let result: DebriefingItem;
      if (isEditMode) {
        result = await updateDebriefing({
          orgId: parsed.orgId,
          projectId: parsed.projectId,
          opportunityId: parsed.opportunityId,
          debriefingId: existingDebriefing.debriefId,
          solicitationNumber: parsed.solicitationNumber,
          contractTitle: parsed.contractTitle,
          awardedOrganization: parsed.awardedOrganization,
          awardNotificationDate: parsed.awardNotificationDate,
          contractingOfficerEmail: parsed.contractingOfficerEmail,
          requesterName: parsed.requesterName,
          requesterTitle: parsed.requesterTitle,
          requesterEmail: parsed.requesterEmail,
          requesterPhone: parsed.requesterPhone,
          requesterAddress: parsed.requesterAddress,
          companyName: parsed.companyName,
        });

        toast({
          title: 'Debriefing Updated',
          description: 'Your debriefing request has been updated.',
        });
      } else {
        result = await createDebriefing(parsed);

        toast({
          title: 'Debriefing Requested',
          description: 'Your debriefing request has been saved.',
        });

        // Reset form for next use
        reset({
          projectId,
          orgId,
          opportunityId,
          solicitationNumber: initialSolicitationNumber,
          contractTitle: initialContractTitle,

          awardedOrganization: '',
          awardNotificationDate: '',
          contractingOfficerEmail: '',
          requesterName: '',
          requesterTitle: '',
          requesterEmail: '',
          requesterPhone: '',
          requesterAddress: '',
          companyName: '',
        });
      }

      onOpenChange(false);
      onSuccess?.(result);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : `Failed to ${isEditMode ? 'update' : 'create'} debriefing request`,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)} autoComplete="off" data-1p-ignore>
          <DialogHeader>
            <DialogTitle>{isEditMode ? 'Edit Debriefing Request' : 'Request Post-Award Debriefing'}</DialogTitle>
            <DialogDescription>
              {isEditMode
                ? 'Update the details of your debriefing request.'
                : 'Submit a request for a post-award debriefing to learn why your proposal was not selected (per FAR 15.506).'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Solicitation / Contract Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Solicitation &amp; Contract Details</h4>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="solicitationNumber">Solicitation Number *</Label>
                  <Input
                    id="solicitationNumber"
                    placeholder="e.g., W911NF-21-R-0001"
                    data-1p-ignore
                    {...register('solicitationNumber')}
                  />
                  {errors.solicitationNumber && (
                    <p className="text-xs text-destructive">{errors.solicitationNumber.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractTitle">Contract Title *</Label>
                  <Input
                    id="contractTitle"
                    placeholder="e.g., IT Services Support"
                    data-1p-ignore
                    {...register('contractTitle')}
                  />
                  {errors.contractTitle && (
                    <p className="text-xs text-destructive">{errors.contractTitle.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="awardedOrganization">Awarded Organization</Label>
                  <Input
                    id="awardedOrganization"
                    placeholder="e.g., Winning Contractor LLC (if known)"
                    data-1p-ignore
                    {...register('awardedOrganization')}
                  />
                  {errors.awardedOrganization && (
                    <p className="text-xs text-destructive">{errors.awardedOrganization.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="awardNotificationDate">Award Notification Date *</Label>
                  <Input
                    id="awardNotificationDate"
                    type="date"
                    data-1p-ignore
                    {...register('awardNotificationDate')}
                  />
                  {errors.awardNotificationDate && (
                    <p className="text-xs text-destructive">{errors.awardNotificationDate.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractingOfficerEmail">Contracting Officer Email *</Label>
                  <Input
                    id="contractingOfficerEmail"
                    type="email"
                    placeholder="jane.doe@agency.gov"
                    data-1p-ignore
                    {...register('contractingOfficerEmail')}
                  />
                  {errors.contractingOfficerEmail && (
                    <p className="text-xs text-destructive">{errors.contractingOfficerEmail.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Requester Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Your Information</h4>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label htmlFor="requesterName">Name *</Label>
                    <Input
                      id="requesterName"
                      placeholder="John Smith"
                      data-1p-ignore
                      {...register('requesterName')}
                    />
                    {errors.requesterName && (
                      <p className="text-xs text-destructive">{errors.requesterName.message}</p>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="requesterTitle">Title *</Label>
                    <Input
                      id="requesterTitle"
                      placeholder="Contracts Manager"
                      data-1p-ignore
                      {...register('requesterTitle')}
                    />
                    {errors.requesterTitle && (
                      <p className="text-xs text-destructive">{errors.requesterTitle.message}</p>
                    )}
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="requesterEmail">Email *</Label>
                  <Input
                    id="requesterEmail"
                    type="email"
                    placeholder="john@company.com"
                    data-1p-ignore
                    {...register('requesterEmail')}
                  />
                  {errors.requesterEmail && (
                    <p className="text-xs text-destructive">{errors.requesterEmail.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="requesterPhone">Phone *</Label>
                  <Input
                    id="requesterPhone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    data-1p-ignore
                    {...register('requesterPhone')}
                  />
                  {errors.requesterPhone && (
                    <p className="text-xs text-destructive">{errors.requesterPhone.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="requesterAddress">Mailing Address *</Label>
                  <Input
                    id="requesterAddress"
                    placeholder="123 Business Ave, Suite 100, City, ST 12345"
                    data-1p-ignore
                    {...register('requesterAddress')}
                  />
                  {errors.requesterAddress && (
                    <p className="text-xs text-destructive">{errors.requesterAddress.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="companyName">Company Name *</Label>
                  <Input
                    id="companyName"
                    placeholder="e.g., Acme Corp"
                    data-1p-ignore
                    {...register('companyName')}
                  />
                  {errors.companyName && (
                    <p className="text-xs text-destructive">{errors.companyName.message}</p>
                  )}
                </div>
              </div>
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
              {isSubmitting
                ? (isEditMode ? 'Saving...' : 'Submitting...')
                : (isEditMode ? 'Save Changes' : 'Request Debriefing')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
