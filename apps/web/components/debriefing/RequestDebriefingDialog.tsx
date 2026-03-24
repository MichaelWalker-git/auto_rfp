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
import { useCreateDebriefing } from '@/lib/hooks/use-debriefing';
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
}: RequestDebriefingDialogProps) => {
  const { toast } = useToast();
  const { createDebriefing } = useCreateDebriefing();

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
      solicitationNumber: initialSolicitationNumber,
      contractTitle: initialContractTitle,
      contractNumber: '',
      awardedOrganization: '',
      awardNotificationDate: '',
      contractingOfficerName: '',
      contractingOfficerEmail: '',
      contractingOfficerAddress: '',
      requesterName: '',
      requesterTitle: '',
      requesterEmail: '',
      requesterAddress: '',
      companyName: '',
    },
  });

  const onSubmit = async (values: CreateDebriefingFormValues) => {
    try {
      const parsed = CreateDebriefingRequestSchema.parse(values);
      const result = await createDebriefing(parsed);

      toast({
        title: 'Debriefing Requested',
        description: 'Your debriefing request has been submitted.',
      });

      // Reset form — restore defaults for next use
      reset({
        projectId,
        orgId,
        opportunityId,
        solicitationNumber: initialSolicitationNumber,
        contractTitle: initialContractTitle,
        contractNumber: '',
        awardedOrganization: '',
        awardNotificationDate: '',
        contractingOfficerName: '',
        contractingOfficerEmail: '',
        contractingOfficerAddress: '',
        requesterName: '',
        requesterTitle: '',
        requesterEmail: '',
        requesterAddress: '',
        companyName: '',
      });

      onOpenChange(false);
      onSuccess?.(result);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create debriefing request',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Request Post-Award Debriefing</DialogTitle>
            <DialogDescription>
              Submit a request for a post-award debriefing to learn why your proposal was not selected (per FAR 15.506).
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
                    {...register('solicitationNumber')}
                  />
                  {errors.solicitationNumber && (
                    <p className="text-xs text-destructive">{errors.solicitationNumber.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractNumber">Contract Number *</Label>
                  <Input
                    id="contractNumber"
                    placeholder="e.g., W911NF-21-C-0001"
                    {...register('contractNumber')}
                  />
                  {errors.contractNumber && (
                    <p className="text-xs text-destructive">{errors.contractNumber.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractTitle">Contract Title *</Label>
                  <Input
                    id="contractTitle"
                    placeholder="e.g., IT Services Support"
                    {...register('contractTitle')}
                  />
                  {errors.contractTitle && (
                    <p className="text-xs text-destructive">{errors.contractTitle.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="awardedOrganization">Awarded Organization *</Label>
                  <Input
                    id="awardedOrganization"
                    placeholder="e.g., Winning Contractor LLC"
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
                    {...register('awardNotificationDate')}
                  />
                  {errors.awardNotificationDate && (
                    <p className="text-xs text-destructive">{errors.awardNotificationDate.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Contracting Officer */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Contracting Officer</h4>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="contractingOfficerName">Name *</Label>
                  <Input
                    id="contractingOfficerName"
                    placeholder="Jane Doe"
                    {...register('contractingOfficerName')}
                  />
                  {errors.contractingOfficerName && (
                    <p className="text-xs text-destructive">{errors.contractingOfficerName.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractingOfficerEmail">Email *</Label>
                  <Input
                    id="contractingOfficerEmail"
                    type="email"
                    placeholder="jane.doe@agency.gov"
                    {...register('contractingOfficerEmail')}
                  />
                  {errors.contractingOfficerEmail && (
                    <p className="text-xs text-destructive">{errors.contractingOfficerEmail.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractingOfficerAddress">Mailing Address *</Label>
                  <Input
                    id="contractingOfficerAddress"
                    placeholder="123 Agency Blvd, Washington DC 20001"
                    {...register('contractingOfficerAddress')}
                  />
                  {errors.contractingOfficerAddress && (
                    <p className="text-xs text-destructive">{errors.contractingOfficerAddress.message}</p>
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
                    {...register('requesterEmail')}
                  />
                  {errors.requesterEmail && (
                    <p className="text-xs text-destructive">{errors.requesterEmail.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="requesterAddress">Mailing Address *</Label>
                  <Input
                    id="requesterAddress"
                    placeholder="123 Business Ave, Suite 100, City, ST 12345"
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
              {isSubmitting ? 'Submitting...' : 'Request Debriefing'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
