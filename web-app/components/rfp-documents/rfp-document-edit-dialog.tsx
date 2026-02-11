'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { type RFPDocumentItem, type RFPDocumentType, RFP_DOCUMENT_TYPES, useUpdateRFPDocument } from '@/lib/hooks/use-rfp-documents';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: RFPDocumentItem | null;
  orgId: string;
  onSuccess?: () => void;
}

export function RFPDocumentEditDialog({ open, onOpenChange, document: doc, orgId, onSuccess }: Props) {
  const { trigger: updateDocument, isMutating } = useUpdateRFPDocument(orgId);
  const { toast } = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentType, setDocumentType] = useState<RFPDocumentType>('OTHER');

  useEffect(() => {
    if (doc) {
      setName(doc.name);
      setDescription(doc.description ?? '');
      setDocumentType(doc.documentType);
    }
  }, [doc]);

  const handleSave = useCallback(async () => {
    if (!doc || !name.trim()) return;
    try {
      await updateDocument({
        projectId: doc.projectId,
        opportunityId: doc.opportunityId,
        documentId: doc.documentId,
        name: name.trim(),
        description: description.trim() || null,
        documentType,
      });
      toast({ title: 'Document updated', description: `"${name.trim()}" has been updated.` });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : 'Could not update document', variant: 'destructive' });
    }
  }, [doc, name, description, documentType, updateDocument, toast, onOpenChange, onSuccess]);

  if (!doc) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Document Details</DialogTitle>
          <DialogDescription>Update the metadata for this document.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Document Name *</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} disabled={isMutating} />
          </div>
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Select value={documentType} onValueChange={(v) => setDocumentType(v as RFPDocumentType)} disabled={isMutating}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(RFP_DOCUMENT_TYPES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Description</Label>
            <Textarea id="edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} disabled={isMutating} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isMutating}>Cancel</Button>
          <Button onClick={handleSave} disabled={isMutating || !name.trim()}>
            {isMutating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : <><Save className="h-4 w-4 mr-2" />Save</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}