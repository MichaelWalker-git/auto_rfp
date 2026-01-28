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
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { useCreateFOIARequest } from '@/lib/hooks/use-foia-requests';
import { FOIA_DOCUMENT_TYPES, FOIA_DOCUMENT_DESCRIPTIONS } from '@auto-rfp/shared';
import type { FOIARequestItem, FOIADocumentType } from '@auto-rfp/shared';

interface CreateFOIARequestDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  agencyName?: string;
  solicitationNumber?: string;
  onSuccess?: (foiaRequest: FOIARequestItem) => void;
}

export function CreateFOIARequestDialog({
  isOpen,
  onOpenChange,
  projectId,
  orgId,
  agencyName: initialAgencyName = '',
  solicitationNumber: initialSolicitationNumber = '',
  onSuccess,
}: CreateFOIARequestDialogProps) {
  const [agencyName, setAgencyName] = useState(initialAgencyName);
  const [agencyFOIAEmail, setAgencyFOIAEmail] = useState('');
  const [agencyFOIAAddress, setAgencyFOIAAddress] = useState('');
  const [solicitationNumber, setSolicitationNumber] = useState(initialSolicitationNumber);
  const [contractNumber, setContractNumber] = useState('');
  const [selectedDocuments, setSelectedDocuments] = useState<FOIADocumentType[]>([]);
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [requesterPhone, setRequesterPhone] = useState('');
  const [requesterAddress, setRequesterAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { createFOIARequest } = useCreateFOIARequest();

  const handleDocumentToggle = (docType: FOIADocumentType) => {
    setSelectedDocuments((prev) =>
      prev.includes(docType)
        ? prev.filter((d) => d !== docType)
        : [...prev, docType]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!agencyName || !solicitationNumber || !requesterName || !requesterEmail) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    if (selectedDocuments.length === 0) {
      toast({
        title: 'Error',
        description: 'Please select at least one document type to request',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createFOIARequest({
        projectId,
        orgId,
        agencyName,
        agencyFOIAEmail: agencyFOIAEmail || undefined,
        agencyFOIAAddress: agencyFOIAAddress || undefined,
        solicitationNumber,
        contractNumber: contractNumber || undefined,
        requestedDocuments: selectedDocuments,
        requesterName,
        requesterEmail,
        requesterPhone: requesterPhone || undefined,
        requesterAddress: requesterAddress || undefined,
        notes: notes || undefined,
      });

      toast({
        title: 'FOIA Request Created',
        description: 'Your FOIA request has been created as a draft.',
      });

      // Reset form
      resetForm();
      onOpenChange(false);
      onSuccess?.(result);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create FOIA request',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setAgencyName(initialAgencyName);
    setAgencyFOIAEmail('');
    setAgencyFOIAAddress('');
    setSolicitationNumber(initialSolicitationNumber);
    setContractNumber('');
    setSelectedDocuments([]);
    setRequesterName('');
    setRequesterEmail('');
    setRequesterPhone('');
    setRequesterAddress('');
    setNotes('');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
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
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    placeholder="e.g., Department of Defense"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agencyFOIAEmail">FOIA Office Email</Label>
                  <Input
                    id="agencyFOIAEmail"
                    type="email"
                    value={agencyFOIAEmail}
                    onChange={(e) => setAgencyFOIAEmail(e.target.value)}
                    placeholder="foia@agency.gov"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="agencyFOIAAddress">FOIA Office Address</Label>
                  <Input
                    id="agencyFOIAAddress"
                    value={agencyFOIAAddress}
                    onChange={(e) => setAgencyFOIAAddress(e.target.value)}
                    placeholder="FOIA Office, 123 Agency Blvd, Washington DC 20001"
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
                    value={solicitationNumber}
                    onChange={(e) => setSolicitationNumber(e.target.value)}
                    placeholder="e.g., W911NF-21-R-0001"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="contractNumber">Contract Number (if known)</Label>
                  <Input
                    id="contractNumber"
                    value={contractNumber}
                    onChange={(e) => setContractNumber(e.target.value)}
                    placeholder="e.g., W911NF-21-C-0001"
                  />
                </div>
              </div>
            </div>

            {/* Requested Documents */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Documents to Request *</h4>
              <div className="grid gap-2">
                {FOIA_DOCUMENT_TYPES.map((docType) => (
                  <div key={docType} className="flex items-start space-x-3">
                    <Checkbox
                      id={docType}
                      checked={selectedDocuments.includes(docType)}
                      onCheckedChange={() => handleDocumentToggle(docType)}
                    />
                    <div className="grid gap-1 leading-none">
                      <Label htmlFor={docType} className="text-sm font-normal cursor-pointer">
                        {FOIA_DOCUMENT_DESCRIPTIONS[docType]}
                      </Label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Requester Information */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Your Contact Information</h4>
              <div className="grid gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="requesterName">Name *</Label>
                  <Input
                    id="requesterName"
                    value={requesterName}
                    onChange={(e) => setRequesterName(e.target.value)}
                    placeholder="John Smith"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="requesterEmail">Email *</Label>
                  <Input
                    id="requesterEmail"
                    type="email"
                    value={requesterEmail}
                    onChange={(e) => setRequesterEmail(e.target.value)}
                    placeholder="john@company.com"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="requesterPhone">Phone</Label>
                  <Input
                    id="requesterPhone"
                    type="tel"
                    value={requesterPhone}
                    onChange={(e) => setRequesterPhone(e.target.value)}
                    placeholder="(555) 123-4567"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="requesterAddress">Mailing Address</Label>
                  <Input
                    id="requesterAddress"
                    value={requesterAddress}
                    onChange={(e) => setRequesterAddress(e.target.value)}
                    placeholder="123 Business Ave, Suite 100, City, ST 12345"
                  />
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="grid gap-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional context or notes for this FOIA request..."
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
              {isSubmitting ? 'Creating...' : 'Create FOIA Request'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
