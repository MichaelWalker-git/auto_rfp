'use client';

import React from 'react';
import { useForm, Controller } from 'react-hook-form';
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
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { useCreateFOIARequest, useUpdateFOIARequest } from '@/lib/hooks/use-foia-requests';
import {
  CreateFOIARequestSchema,
  FOIA_DOCUMENT_TYPES,
  FOIA_DOCUMENT_DESCRIPTIONS,
} from '@auto-rfp/core';
import type { FOIARequestItem, FOIADocumentType } from '@auto-rfp/core';
import { z } from 'zod';

type CreateFOIARequestFormValues = z.input<typeof CreateFOIARequestSchema>;

interface CreateFOIARequestDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  opportunityId: string;
  agencyName?: string;
  solicitationNumber?: string;
  contractTitle?: string;
  onSuccess?: (foiaRequest: FOIARequestItem) => void;
  /** When provided, dialog operates in edit mode */
  existingRequest?: FOIARequestItem;
}

export const CreateFOIARequestDialog = ({
  isOpen,
  onOpenChange,
  projectId,
  orgId,
  opportunityId,
  agencyName: initialAgencyName = '',
  solicitationNumber: initialSolicitationNumber = '',
  contractTitle: initialContractTitle = '',
  onSuccess,
  existingRequest,
}: CreateFOIARequestDialogProps) => {
  const { toast } = useToast();
  const { createFOIARequest } = useCreateFOIARequest();
  const { updateFOIARequest } = useUpdateFOIARequest();

  const isEditMode = !!existingRequest;

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateFOIARequestFormValues>({
    resolver: zodResolver(CreateFOIARequestSchema),
    defaultValues: {
      projectId,
      orgId,
      opportunityId,
      agencyName: existingRequest?.agencyName ?? initialAgencyName,
      agencyFOIAEmail: existingRequest?.agencyFOIAEmail ?? '',
      agencyFOIAAddress: existingRequest?.agencyFOIAAddress ?? '',
      solicitationNumber: existingRequest?.solicitationNumber ?? initialSolicitationNumber,
      contractTitle: existingRequest?.contractTitle ?? initialContractTitle,
      requestedDocuments: existingRequest?.requestedDocuments ?? [],
      requesterName: existingRequest?.requesterName ?? '',
      requesterTitle: existingRequest?.requesterTitle ?? '',
      requesterEmail: existingRequest?.requesterEmail ?? '',
      requesterPhone: existingRequest?.requesterPhone ?? '',
      requesterAddress: existingRequest?.requesterAddress ?? '',
      companyName: existingRequest?.companyName ?? '',
      awardeeName: existingRequest?.awardeeName ?? '',
      awardDate: existingRequest?.awardDate ?? '',
      feeLimit: existingRequest?.feeLimit ?? 0,
    },
  });

  const onSubmit = async (values: CreateFOIARequestFormValues) => {
    try {
      const parsed = CreateFOIARequestSchema.parse(values);

      let result: FOIARequestItem;
      if (isEditMode) {
        result = await updateFOIARequest({
          orgId: parsed.orgId,
          projectId: parsed.projectId,
          opportunityId: parsed.opportunityId,
          foiaRequestId: existingRequest.foiaId,
          agencyName: parsed.agencyName,
          agencyFOIAEmail: parsed.agencyFOIAEmail,
          agencyFOIAAddress: parsed.agencyFOIAAddress,
          solicitationNumber: parsed.solicitationNumber,
          contractTitle: parsed.contractTitle,
          requestedDocuments: parsed.requestedDocuments,
          requesterName: parsed.requesterName,
          requesterTitle: parsed.requesterTitle,
          requesterEmail: parsed.requesterEmail,
          requesterPhone: parsed.requesterPhone,
          requesterAddress: parsed.requesterAddress,
          companyName: parsed.companyName,
          awardeeName: parsed.awardeeName,
          awardDate: parsed.awardDate,
          feeLimit: parsed.feeLimit,
        });

        toast({
          title: 'FOIA Request Updated',
          description: 'Your FOIA request has been updated.',
        });
      } else {
        result = await createFOIARequest(parsed);

        toast({
          title: 'FOIA Request Created',
          description: 'Your FOIA request has been saved.',
        });

        // Reset form for next use
        reset({
          projectId,
          orgId,
          opportunityId,
          agencyName: initialAgencyName,
          agencyFOIAEmail: '',
          agencyFOIAAddress: '',
          solicitationNumber: initialSolicitationNumber,
          contractTitle: initialContractTitle,
          requestedDocuments: [],
          customDocumentRequests: [],
          feeLimit: 0,
          requesterName: '',
          requesterTitle: '',
          requesterEmail: '',
          requesterPhone: '',
          requesterAddress: '',
          companyName: '',
          awardeeName: '',
          awardDate: '',
        });
      }

      onOpenChange(false);
      onSuccess?.(result);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : `Failed to ${isEditMode ? 'update' : 'create'} FOIA request`,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)} autoComplete="off" data-1p-ignore>
          <DialogHeader>
            <DialogTitle>{isEditMode ? 'Edit FOIA Request' : 'Create FOIA Request'}</DialogTitle>
            <DialogDescription>
              {isEditMode
                ? 'Update the details of your FOIA request.'
                : 'Submit a Freedom of Information Act request to obtain evaluation documents.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-6 py-4">
            {/* Agency Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Agency Information</h4>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="agencyName">Agency Name *</Label>
                  <Input
                    id="agencyName"
                    placeholder="e.g., Department of Defense"
                    data-1p-ignore
                    {...register('agencyName')}
                  />
                  {errors.agencyName && (
                    <p className="text-xs text-destructive">{errors.agencyName.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agencyFOIAEmail">FOIA Office Email *</Label>
                  <Input
                    id="agencyFOIAEmail"
                    type="email"
                    placeholder="foia@agency.gov"
                    data-1p-ignore
                    {...register('agencyFOIAEmail')}
                  />
                  {errors.agencyFOIAEmail && (
                    <p className="text-xs text-destructive">{errors.agencyFOIAEmail.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agencyFOIAAddress">FOIA Office Address *</Label>
                  <Input
                    id="agencyFOIAAddress"
                    placeholder="FOIA Office, 123 Agency Blvd, Washington DC 20001"
                    data-1p-ignore
                    {...register('agencyFOIAAddress')}
                  />
                  {errors.agencyFOIAAddress && (
                    <p className="text-xs text-destructive">{errors.agencyFOIAAddress.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Contract Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Contract Information</h4>
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
                  <Label htmlFor="awardeeName">Awardee Name</Label>
                  <Input
                    id="awardeeName"
                    placeholder="e.g., Winning Contractor LLC (if known)"
                    data-1p-ignore
                    {...register('awardeeName')}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="awardDate">Award Date *</Label>
                  <Input
                    id="awardDate"
                    type="date"
                    data-1p-ignore
                    {...register('awardDate')}
                  />
                  {errors.awardDate && (
                    <p className="text-xs text-destructive">{errors.awardDate.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Requested Documents */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Documents to Request *</h4>
              <Controller
                name="requestedDocuments"
                control={control}
                render={({ field }) => (
                  <div className="grid gap-2">
                    {FOIA_DOCUMENT_TYPES.map((docType: FOIADocumentType) => (
                      <div key={docType} className="flex items-start space-x-3">
                        <Checkbox
                          id={docType}
                          checked={field.value?.includes(docType) ?? false}
                          onCheckedChange={(checked) => {
                            const current = field.value ?? [];
                            field.onChange(
                              checked
                                ? [...current, docType]
                                : current.filter((d) => d !== docType),
                            );
                          }}
                        />
                        <div className="grid gap-1 leading-none">
                          <Label htmlFor={docType} className="text-sm font-normal cursor-pointer">
                            {FOIA_DOCUMENT_DESCRIPTIONS[docType]}
                          </Label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              />
              {errors.requestedDocuments && (
                <p className="text-xs text-destructive">{errors.requestedDocuments.message}</p>
              )}
            </div>

            {/* Fees */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Fees</h4>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="feeLimit">Fee Limit ($)</Label>
                  <Input
                    id="feeLimit"
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    data-1p-ignore
                    {...register('feeLimit', { valueAsNumber: true })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum amount you are willing to pay in FOIA processing fees. Set to 0 for no fee commitment.
                  </p>
                  {errors.feeLimit && (
                    <p className="text-xs text-destructive">{errors.feeLimit.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Requester Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Your Contact Information</h4>
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
                ? (isEditMode ? 'Saving...' : 'Creating...')
                : (isEditMode ? 'Save Changes' : 'Create FOIA Request')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
