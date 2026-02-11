'use client';

import React, { useCallback, useRef, useState } from 'react';
import { FileUp, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/components/ui/use-toast';
import { type RFPDocumentType, RFP_DOCUMENT_TYPES, useCreateRFPDocument, uploadFileToPresignedUrl } from '@/lib/hooks/use-rfp-documents';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  orgId: string;
  onSuccess?: () => void;
}

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'image/png',
  'image/jpeg',
  'image/gif',
  'text/plain',
  'text/markdown',
];

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export function RFPDocumentUploadDialog({ open, onOpenChange, projectId, orgId, onSuccess }: Props) {
  const { trigger: createDocument, isMutating } = useCreateRFPDocument(orgId);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [documentType, setDocumentType] = useState<RFPDocumentType>('OTHER');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const resetForm = useCallback(() => {
    setFile(null);
    setName('');
    setDescription('');
    setDocumentType('OTHER');
    setUploadProgress(0);
    setIsUploading(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!ALLOWED_TYPES.includes(selected.type)) {
      toast({ title: 'Unsupported file type', description: 'Please upload a PDF, DOCX, XLSX, image, or text file.', variant: 'destructive' });
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      toast({ title: 'File too large', description: 'Maximum file size is 100 MB.', variant: 'destructive' });
      return;
    }
    setFile(selected);
    if (!name) setName(selected.name.replace(/\.[^/.]+$/, ''));
  }, [name, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (!dropped) return;
    if (!ALLOWED_TYPES.includes(dropped.type)) {
      toast({ title: 'Unsupported file type', description: 'Please upload a PDF, DOCX, XLSX, image, or text file.', variant: 'destructive' });
      return;
    }
    if (dropped.size > MAX_FILE_SIZE) {
      toast({ title: 'File too large', description: 'Maximum file size is 100 MB.', variant: 'destructive' });
      return;
    }
    setFile(dropped);
    if (!name) setName(dropped.name.replace(/\.[^/.]+$/, ''));
  }, [name, toast]);

  const handleSubmit = useCallback(async () => {
    if (!file || !name.trim()) {
      toast({ title: 'Missing fields', description: 'Please select a file and provide a name.', variant: 'destructive' });
      return;
    }
    try {
      setIsUploading(true);
      setUploadProgress(0);
      const result = await createDocument({
        projectId,
        opportunityId: 'default',
        name: name.trim(),
        description: description.trim() || null,
        documentType,
        mimeType: file.type,
        fileSizeBytes: file.size,
        originalFileName: file.name,
      });
      setUploadProgress(30);
      await uploadFileToPresignedUrl(result.upload.url, file, (percent) => {
        setUploadProgress(30 + Math.round(percent * 0.7));
      });
      setUploadProgress(100);
      toast({ title: 'Document uploaded', description: `"${name.trim()}" has been uploaded and will be synced to Linear.` });
      resetForm();
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({ title: 'Upload failed', description: err instanceof Error ? err.message : 'Could not upload document', variant: 'destructive' });
    } finally {
      setIsUploading(false);
    }
  }, [file, name, description, documentType, projectId, createDocument, resetForm, onOpenChange, onSuccess, toast]);

  const isBusy = isMutating || isUploading;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload RFP Document</DialogTitle>
          <DialogDescription>Upload a document developed during the RFP process. It will be automatically synced to Linear.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div
            className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileUp className="h-8 w-8 text-primary" />
                <div className="text-left">
                  <p className="font-medium text-sm">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); setFile(null); }}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Drag & drop a file here, or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, XLSX, images, or text files up to 100 MB</p>
              </>
            )}
            <input ref={fileInputRef} type="file" className="hidden" accept={ALLOWED_TYPES.join(',')} onChange={handleFileSelect} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-name">Document Name *</Label>
            <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Technical Proposal v2" disabled={isBusy} />
          </div>
          <div className="space-y-1.5">
            <Label>Document Type</Label>
            <Select value={documentType} onValueChange={(v) => setDocumentType(v as RFPDocumentType)} disabled={isBusy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(RFP_DOCUMENT_TYPES).map(([key, label]) => (
                  <SelectItem key={key} value={key}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-desc">Description (optional)</Label>
            <Textarea id="doc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of this document..." rows={2} disabled={isBusy} />
          </div>
          {isUploading && (
            <div className="space-y-1">
              <Progress value={uploadProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">{uploadProgress}% uploaded</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }} disabled={isBusy}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isBusy || !file || !name.trim()}>
            {isBusy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uploading...</> : <><Upload className="h-4 w-4 mr-2" />Upload</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}