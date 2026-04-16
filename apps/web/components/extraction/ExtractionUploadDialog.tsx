'use client';

import { useState, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { useStartExtraction, useExtractionJob, useDrafts } from '@/lib/hooks/use-extraction';
import { useToast } from '@/components/ui/use-toast';
import { usePresignUpload, uploadFileToS3 } from '@/lib/hooks/use-presign';
import { DraftReviewCard } from './DraftReviewCard';
import { ExtractionTargetType } from '@auto-rfp/core';

interface ExtractionUploadDialogProps {
  orgId: string;
  targetType?: ExtractionTargetType;
  onExtractionComplete?: () => void;
  trigger?: React.ReactNode;
}

// Copy/messaging configuration per target type
const TARGET_CONFIG: Record<ExtractionTargetType, {
  title: string;
  description: string;
  fileHint: string;
  successItem: string;
  successItemPlural: string;
  noDataMessage: string;
  s3Prefix: string;
  acceptedFiles: string;
}> = {
  PAST_PERFORMANCE: {
    title: 'Extract Past Performance',
    description: 'Upload case studies, project summaries, or past performance documents. AI will extract project details automatically.',
    fileHint: 'PDF, DOCX, XLSX, CSV, TXT files supported',
    successItem: 'past performance record',
    successItemPlural: 'past performance records',
    noDataMessage: 'No past performance data could be extracted. Try uploading case studies or contract summaries.',
    s3Prefix: 'past-performance',
    acceptedFiles: '.pdf,.docx,.doc,.xlsx,.xls,.csv,.txt',
  },
  LABOR_RATE: {
    title: 'Extract Labor Rates',
    description: 'Upload rate cards, GSA schedules, or pricing documents. AI will extract labor rates automatically.',
    fileHint: 'PDF, DOCX, XLSX, CSV files supported',
    successItem: 'labor rate',
    successItemPlural: 'labor rates',
    noDataMessage: 'No labor rate data could be extracted. Try uploading rate cards or GSA schedules.',
    s3Prefix: 'labor-rates',
    acceptedFiles: '.pdf,.docx,.doc,.xlsx,.xls,.csv,.txt',
  },
  BOM_ITEM: {
    title: 'Extract BOM Items',
    description: 'Upload bill of materials, equipment lists, or pricing sheets. AI will extract items automatically.',
    fileHint: 'PDF, DOCX, XLSX, CSV files supported',
    successItem: 'BOM item',
    successItemPlural: 'BOM items',
    noDataMessage: 'No BOM items could be extracted. Try uploading equipment lists or material pricing sheets.',
    s3Prefix: 'bom-items',
    acceptedFiles: '.pdf,.docx,.doc,.xlsx,.xls,.csv,.txt',
  },
};

interface UploadedFile {
  file: File;
  s3Key?: string;
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  error?: string;
}

export const ExtractionUploadDialog = ({
  orgId,
  targetType = 'PAST_PERFORMANCE',
  onExtractionComplete,
  trigger,
}: ExtractionUploadDialogProps) => {
  const config = TARGET_CONFIG[targetType];
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { startExtraction } = useStartExtraction();
  const { job } = useExtractionJob(orgId, jobId ?? undefined);
  // Only fetch past performance drafts for inline review - labor rate/BOM drafts are handled by parent components
  const { drafts, refresh: refreshDrafts } = useDrafts(
    orgId, 
    showDrafts && targetType === 'PAST_PERFORMANCE' ? { status: 'DRAFT' } : undefined
  );
  const { toast } = useToast();
  const { trigger: presign } = usePresignUpload();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    addFiles(selectedFiles);
  };

  const addFiles = (selectedFiles: File[]) => {
    const newFiles: UploadedFile[] = selectedFiles.map((file) => ({
      file,
      status: 'pending',
    }));
    setFiles((prev) => [...prev, ...newFiles]);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    // Filter to only accepted file types
    const acceptedExtensions = config.acceptedFiles.split(',').map(ext => ext.trim().toLowerCase());
    const validFiles = droppedFiles.filter(file => {
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      return acceptedExtensions.includes(ext);
    });
    
    if (validFiles.length > 0) {
      addFiles(validFiles);
    }
    if (validFiles.length < droppedFiles.length) {
      toast({
        title: 'Some files skipped',
        description: `Only ${config.fileHint.replace(' files supported', '')} files are accepted.`,
        variant: 'destructive',
      });
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadFiles = async () => {
    setIsUploading(true);
    const uploadedSourceFiles: Array<{ fileName: string; s3Key: string; fileSize: number }> = [];

    for (let i = 0; i < files.length; i++) {
      const fileEntry = files[i];
      if (fileEntry.status === 'uploaded' && fileEntry.s3Key) {
        uploadedSourceFiles.push({
          fileName: fileEntry.file.name,
          s3Key: fileEntry.s3Key,
          fileSize: fileEntry.file.size,
        });
        continue;
      }

      setFiles((prev) =>
        prev.map((f, idx) => (idx === i ? { ...f, status: 'uploading' } : f))
      );

      try {
        // Get presigned upload URL using existing hook
        const contentType = fileEntry.file.type || 'application/octet-stream';
        const response = await presign({
          fileName: fileEntry.file.name,
          contentType,
          prefix: `extraction/${orgId}/${config.s3Prefix}`,
        });

        // Upload to S3
        await uploadFileToS3(response.url, response.method, fileEntry.file);

        uploadedSourceFiles.push({
          fileName: fileEntry.file.name,
          s3Key: response.key,
          fileSize: fileEntry.file.size || 1, // Ensure fileSize > 0 for validation
        });
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i ? { ...f, status: 'uploaded', s3Key: response.key } : f
          )
        );
      } catch (error) {
        console.error('Upload failed:', error);
        setFiles((prev) =>
          prev.map((f, idx) =>
            idx === i
              ? { ...f, status: 'error', error: 'Failed to upload file' }
              : f
          )
        );
      }
    }

    // Start extraction job if we have uploaded files
    if (uploadedSourceFiles.length > 0) {
      try {
        const extractionJob = await startExtraction({
          orgId,
          sourceType: 'DIRECT_UPLOAD',
          targetType,
          sourceFiles: uploadedSourceFiles,
        });
        setJobId(extractionJob.jobId);
        toast({
          title: 'Extraction Started',
          description: `Processing ${uploadedSourceFiles.length} file(s) for ${config.successItemPlural}.`,
        });
      } catch (error) {
        console.error('Failed to start extraction:', error);
        toast({
          title: 'Error',
          description: 'Failed to start extraction. Please try again.',
          variant: 'destructive',
        });
      }
    }

    setIsUploading(false);
  };

  const handleViewDrafts = () => {
    // Close dialog and refresh the page's draft list
    setOpen(false);
    setFiles([]);
    setJobId(null);
    onExtractionComplete?.();
  };

  const handleClose = () => {
    if (job?.status === 'COMPLETED') {
      onExtractionComplete?.();
    }
    setOpen(false);
    setFiles([]);
    setJobId(null);
    setShowDrafts(false);
  };

  const progressPercent = job
    ? job.totalItems > 0
      ? Math.round((job.processedItems / job.totalItems) * 100)
      : 0
    : 0;

  // Reset state when dialog opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      // Reset all state when opening
      setFiles([]);
      setJobId(null);
      setShowDrafts(false);
    }
    setOpen(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Upload Documents
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className={showDrafts ? "sm:max-w-3xl" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>
            {!jobId
              ? config.title
              : showDrafts
              ? 'Review Extracted Data'
              : !job || job.status === 'PROCESSING' || job.status === 'PENDING'
              ? 'Processing Documents...'
              : job.status === 'COMPLETED'
              ? 'Extraction Complete'
              : 'Extraction Failed'}
          </DialogTitle>
          <DialogDescription>
            {!jobId
              ? config.description
              : showDrafts
              ? `Review the extracted ${config.successItemPlural} below. Confirm to add to your library or discard if incorrect.`
              : !job || job.status === 'PROCESSING' || job.status === 'PENDING'
              ? `Analyzing ${files.length} document${files.length > 1 ? 's' : ''} with AI to extract ${config.successItemPlural}...`
              : job.status === 'COMPLETED' && job.draftsCreated.length > 0
              ? `Successfully extracted ${job.draftsCreated.length} ${job.draftsCreated.length > 1 ? config.successItemPlural : config.successItem}. Click "View Drafts" to review and confirm.`
              : job.status === 'COMPLETED'
              ? config.noDataMessage
              : 'Extraction failed. Please try again or upload a different document.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* File Drop Zone */}
          {!jobId && (
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                isDragging 
                  ? 'border-primary bg-primary/5' 
                  : 'hover:border-primary'
              }`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <Upload className={`h-8 w-8 mx-auto mb-2 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
              <p className={`text-sm ${isDragging ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                {isDragging ? 'Drop files here' : 'Click to select files or drag and drop'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {config.fileHint}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={config.acceptedFiles}
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          )}

          {/* File List */}
          {files.length > 0 && !jobId && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {files.map((fileEntry, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-2 p-2 bg-muted rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate max-w-[200px]" title={fileEntry.file.name}>
                      {fileEntry.file.name}
                    </span>
                    {fileEntry.status === 'uploading' && (
                      <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                    )}
                    {fileEntry.status === 'uploaded' && (
                      <CheckCircle className="h-4 w-4 text-emerald-500 shrink-0" />
                    )}
                    {fileEntry.status === 'error' && (
                      <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(index)}
                    disabled={isUploading}
                    className="shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Extraction Progress */}
          {jobId && job && !showDrafts && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Extraction Progress</span>
                <Badge
                  variant={
                    job.status === 'COMPLETED'
                      ? 'default'
                      : job.status === 'FAILED'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {job.status}
                </Badge>
              </div>
              <Progress value={progressPercent} className="h-2" />
              <p className="text-xs text-muted-foreground">
                {job.processedItems} of {job.totalItems} items processed
                {job.draftsCreated.length > 0 && ` • ${job.draftsCreated.length} drafts created`}
              </p>
              {job.status === 'COMPLETED' && job.draftsCreated.length > 0 && (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  ✓ {job.draftsCreated.length} {job.draftsCreated.length > 1 ? config.successItemPlural : config.successItem} draft(s) ready for review
                </p>
              )}
              {job.status === 'COMPLETED' && job.draftsCreated.length === 0 && (
                <p className="text-sm text-amber-600 dark:text-amber-400">
                  ⚠ {config.noDataMessage}
                </p>
              )}
            </div>
          )}

          {/* Draft Review */}
          {showDrafts && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              <h4 className="text-sm font-medium">Review Extracted Data</h4>
              {drafts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending drafts to review.</p>
              ) : (
                drafts.map((draft) => (
                  <DraftReviewCard
                    key={draft.projectId}
                    orgId={orgId}
                    draft={draft}
                    onSuccess={() => {
                      refreshDrafts();
                      onExtractionComplete?.();
                    }}
                  />
                ))
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          {!jobId ? (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={uploadFiles}
                disabled={files.length === 0 || isUploading}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload & Extract
                  </>
                )}
              </Button>
            </>
          ) : showDrafts ? (
            <Button onClick={handleClose}>
              Done
            </Button>
          ) : (
            <Button
              onClick={job?.status === 'COMPLETED' && job.draftsCreated.length > 0 ? handleViewDrafts : handleClose}
              disabled={job?.status === 'PROCESSING' || job?.status === 'PENDING'}
            >
              {job?.status === 'COMPLETED' && job.draftsCreated.length > 0 ? 'View Drafts' : 'Close'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
