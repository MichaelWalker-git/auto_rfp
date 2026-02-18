'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Save, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { type RFPDocumentItem, type SignatureStatus, SIGNATURE_STATUSES, useUpdateSignatureStatus } from '@/lib/hooks/use-rfp-documents';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: RFPDocumentItem | null;
  orgId: string;
  onSuccess?: () => void;
}

const SIGNER_STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING: <Clock className="h-4 w-4 text-yellow-600" />,
  SIGNED: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  REJECTED: <XCircle className="h-4 w-4 text-red-600" />,
};

export function SignatureTrackerDialog({ open, onOpenChange, document: doc, orgId, onSuccess }: Props) {
  const { trigger: updateSignature, isMutating } = useUpdateSignatureStatus(orgId);
  const { toast } = useToast();

  const [signatureStatus, setSignatureStatus] = useState<SignatureStatus>('NOT_REQUIRED');

  useEffect(() => {
    if (doc) {
      setSignatureStatus(doc.signatureStatus);
    }
  }, [doc]);

  const handleSave = useCallback(async () => {
    if (!doc) return;
    try {
      await updateSignature({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
        signatureStatus,
        signatureDetails: doc.signatureDetails,
      });
      toast({ title: 'Signature status updated', description: `Status changed to "${SIGNATURE_STATUSES[signatureStatus]}".` });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : 'Could not update signature status', variant: 'destructive' });
    }
  }, [doc, signatureStatus, updateSignature, toast, onOpenChange, onSuccess]);

  if (!doc) return null;

  const signers = doc.signatureDetails?.signers ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Signature Status</DialogTitle>
          <DialogDescription>Track the signature status for &quot;{doc.name}&quot;.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Current Status</Label>
            <Select value={signatureStatus} onValueChange={(v) => setSignatureStatus(v as SignatureStatus)} disabled={isMutating}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(SIGNATURE_STATUSES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {signers.length > 0 && (
            <div className="space-y-2">
              <Label>Signers</Label>
              <div className="space-y-2">
                {signers.map((signer) => (
                  <div key={signer.id} className="flex items-center gap-3 rounded-lg border p-3">
                    {SIGNER_STATUS_ICON[signer.status] ?? <Clock className="h-4 w-4 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{signer.name}</p>
                      <p className="text-xs text-muted-foreground">{signer.role} • {signer.email}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {signer.status}
                    </Badge>
                    {signer.signedAt && (
                      <span className="text-xs text-muted-foreground">
                        {new Date(signer.signedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {signers.length === 0 && signatureStatus !== 'NOT_REQUIRED' && (
            <div className="rounded-lg border border-dashed p-4 text-center">
              <p className="text-sm text-muted-foreground">
                No signers configured yet. Signers can be added via the API or when integrating with a signing service.
              </p>
            </div>
          )}

          {doc.signatureDetails?.driveFileUrl && (
            <div className="space-y-1.5">
              <Label>Google Drive Link</Label>
              <a
                href={doc.signatureDetails.driveFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline break-all"
              >
                {doc.signatureDetails.driveFileUrl}
              </a>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMutating}>Cancel</Button>
          <Button onClick={handleSave} disabled={isMutating}>
            {isMutating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" />Save</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}