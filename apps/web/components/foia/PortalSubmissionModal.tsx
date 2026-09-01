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
import { useToast } from '@/components/ui/use-toast';
import type { FOIARequestItem } from '@auto-rfp/core';
import { ExternalLink, Copy, CheckCircle2 } from 'lucide-react';

interface PortalSubmissionModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  foiaRequest: FOIARequestItem;
}

export const PortalSubmissionModal = ({
  isOpen,
  onOpenChange,
  foiaRequest,
}: PortalSubmissionModalProps) => {
  const { toast } = useToast();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopyField = (fieldName: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
    toast({
      title: 'Copied',
      description: `${fieldName} copied to clipboard`,
    });
  };

  const handleOpenPortal = () => {
    if (foiaRequest.portalBaseUrl) {
      window.open(foiaRequest.portalBaseUrl, '_blank', 'noopener,noreferrer');
    }
  };



  const formFields = [
    { label: 'Agency Name', value: foiaRequest.agencyName },
    { label: 'Solicitation Number', value: foiaRequest.solicitationNumber },
    { label: 'Contract Title', value: foiaRequest.contractTitle },
    { label: 'Award Date', value: foiaRequest.awardDate },
    { label: 'Awardee Name', value: foiaRequest.awardeeName },
    { label: 'Requester Name', value: foiaRequest.requesterName },
    { label: 'Requester Title', value: foiaRequest.requesterTitle },
    { label: 'Requester Email', value: foiaRequest.requesterEmail },
    { label: 'Requester Phone', value: foiaRequest.requesterPhone },
    { label: 'Requester Address', value: foiaRequest.requesterAddress },
    { label: 'Company Name', value: foiaRequest.companyName },
  ].filter(field => field.value);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Submit to Portal</DialogTitle>
          <DialogDescription>
            Follow these steps to submit your FOIA request through the agency portal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Step 1: Open Portal */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">
                1
              </div>
              <h4 className="text-sm font-semibold">Open the Portal</h4>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenPortal}
              className="ml-8 w-full text-left justify-start"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              {foiaRequest.portalBaseUrl}
            </Button>
          </div>

          {/* Step 2: Select Record Type */}
          {foiaRequest.portalRecordTypeField && foiaRequest.portalRecordTypeValue && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">
                  2
                </div>
                <h4 className="text-sm font-semibold">Select the Correct Record Type</h4>
              </div>
              <div className="ml-8 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Find the dropdown field: <span className="font-mono text-foreground">{foiaRequest.portalRecordTypeField}</span>
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-blue-50 border border-blue-200 rounded px-3 py-2">
                    <p className="text-sm font-semibold text-blue-900">
                      {foiaRequest.portalRecordTypeValue}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyField('Record Type', foiaRequest.portalRecordTypeValue!)}
                  >
                    {copiedField === 'Record Type' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Fill Form Fields */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">
                {foiaRequest.portalRecordTypeField ? '3' : '2'}
              </div>
              <h4 className="text-sm font-semibold">Fill in the Form Fields</h4>
            </div>
            <div className="ml-8 space-y-2 max-h-64 overflow-y-auto">
              {formFields.map((field, idx) => (
                <div key={idx} className="flex items-start gap-2 text-xs">
                  <div className="flex-1 space-y-0.5">
                    <p className="font-medium text-muted-foreground">{field.label}</p>
                    <p className="text-foreground bg-gray-50 border rounded px-2 py-1">
                      {field.value}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0"
                    onClick={() => handleCopyField(field.label, field.value!)}
                  >
                    {copiedField === field.label ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Step 4: Documents Requested */}
          {foiaRequest.requestedDocuments && foiaRequest.requestedDocuments.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold">
                  {foiaRequest.portalRecordTypeField ? '4' : '3'}
                </div>
                <h4 className="text-sm font-semibold">Requested Documents</h4>
              </div>
              <div className="ml-8 text-xs space-y-1">
                {foiaRequest.requestedDocuments.map((doc, idx) => (
                  <p key={idx} className="text-muted-foreground">• {doc}</p>
                ))}
              </div>
            </div>
          )}

          {/* Step 5: Submit */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-xs font-bold">
                ✓
              </div>
              <h4 className="text-sm font-semibold">Complete CAPTCHA and Submit</h4>
            </div>
            <p className="ml-8 text-xs text-muted-foreground">
              Solve the CAPTCHA on the portal form and click their submit button to complete your request.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
