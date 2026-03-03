'use client';

import React, { useEffect } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { useCreateFOIARequest } from '@/lib/hooks/use-foia-requests';
import { useOrgPrimaryContact } from '@/lib/hooks/use-org-contact';
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
  agencyName?: string;
  solicitationNumber?: string;
  onSuccess?: (foiaRequest: FOIARequestItem) => void;
}

export const CreateFOIARequestDialog = ({
  isOpen,
  onOpenChange,
  projectId,
  orgId,
  agencyName: initialAgencyName = '',
  solicitationNumber: initialSolicitationNumber = '',
  onSuccess,
}: CreateFOIARequestDialogProps) => {
  const { toast } = useToast();
  const { createFOIARequest } = useCreateFOIARequest();

  // Fetch org primary contact to pre-populate requester fields
  const { data: contactData } = useOrgPrimaryContact(orgId);
  const primaryContact = contactData?.contact;

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
      agencyName: initialAgencyName,
      solicitationNumber: initialSolicitationNumber,
      requestedDocuments: [],
      requesterCategory: 'OTHER',
      feeLimit: 50,
      requestFeeWaiver: false,
    },
  });

  // When the dialog opens and primary contact is available, pre-populate requester fields
  // Only sets values if the fields are currently empty (don't overwrite user edits)
  useEffect(() => {
    if (isOpen && primaryContact) {
      reset((prev) => ({
        ...prev,
        requesterName: prev.requesterName || primaryContact.name,
        requesterEmail: prev.requesterEmail || primaryContact.email,
        requesterPhone: prev.requesterPhone || primaryContact.phone || '',
        requesterAddress: prev.requesterAddress || primaryContact.address || '',
      }));
    }
  }, [isOpen, primaryContact, reset]);

  const onSubmit = async (values: CreateFOIARequestFormValues) => {
    try {
      const result = await createFOIARequest(values);

      toast({
        title: 'FOIA Request Created',
        description: 'Your FOIA request has been created as a draft.',
      });

      // Reset form — restore primary contact defaults for next use
      reset({
        projectId,
        orgId,
        agencyName: initialAgencyName,
        solicitationNumber: initialSolicitationNumber,
        requestedDocuments: [],
        requesterCategory: 'OTHER',
        feeLimit: 50,
        requestFeeWaiver: false,
        requesterName: primaryContact?.name ?? '',
        requesterEmail: primaryContact?.email ?? '',
        requesterPhone: primaryContact?.phone ?? '',
        requesterAddress: primaryContact?.address ?? '',
      });
      onOpenChange(false);
      onSuccess?.(result);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create FOIA request',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogHeader>
            <DialogTitle>Create FOIA Request</DialogTitle>
            <DialogDescription>
              Submit a Freedom of Information Act request to obtain evaluation documents.
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
                    {...register('agencyName')}
                  />
                  {errors.agencyName && (
                    <p className="text-xs text-destructive">{errors.agencyName.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agencyFOIAEmail">FOIA Office Email</Label>
                  <Input
                    id="agencyFOIAEmail"
                    type="email"
                    placeholder="foia@agency.gov"
                    {...register('agencyFOIAEmail')}
                  />
                  {errors.agencyFOIAEmail && (
                    <p className="text-xs text-destructive">{errors.agencyFOIAEmail.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agencyFOIAAddress">FOIA Office Address</Label>
                  <Input
                    id="agencyFOIAAddress"
                    placeholder="FOIA Office, 123 Agency Blvd, Washington DC 20001"
                    {...register('agencyFOIAAddress')}
                  />
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
                    {...register('solicitationNumber')}
                  />
                  {errors.solicitationNumber && (
                    <p className="text-xs text-destructive">{errors.solicitationNumber.message}</p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractNumber">Contract Number (if known)</Label>
                  <Input
                    id="contractNumber"
                    placeholder="e.g., W911NF-21-C-0001"
                    {...register('contractNumber')}
                  />
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

            {/* Requester Information */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Your Contact Information</h4>
                {primaryContact && (
                  <span className="text-xs text-muted-foreground">
                    Pre-filled from{' '}
                    <span className="font-medium text-foreground">{primaryContact.name}</span>
                    {' '}(primary contact)
                  </span>
                )}
              </div>
              <div className="grid gap-3">
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
                  <Label htmlFor="requesterPhone">Phone</Label>
                  <Input
                    id="requesterPhone"
                    type="tel"
                    placeholder="(555) 123-4567"
                    {...register('requesterPhone')}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="requesterAddress">Mailing Address</Label>
                  <Input
                    id="requesterAddress"
                    placeholder="123 Business Ave, Suite 100, City, ST 12345"
                    {...register('requesterAddress')}
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="grid gap-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                placeholder="Any additional context or notes for this FOIA request..."
                rows={3}
                {...register('notes')}
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
              {isSubmitting ? 'Creating...' : 'Create FOIA Request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
