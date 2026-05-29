'use client';

import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AlertCircle, Loader2, Upload, XCircle } from 'lucide-react';
import { UploadFileToS3 } from '@/components/upload/UploadFileToS3';
import { UploadQueueItem } from './UploadQueueItem';
import { UPLOAD_CONFIG } from '../lib/upload-config';
import { UploadQueueItem as UploadQueueItemType } from '../lib/upload-config';

interface UploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  kbId: string;
  uploadQueue: UploadQueueItemType[];
  isBatchUploading: boolean;
  uploadErrors: string[];
  uploadStats: {
    total: number;
    completed: number;
    failed: number;
    inProgress: number;
    avgProgress: number;
  };
  uploaderRef: React.RefObject<any>;
  onSelectFiles: (files: FileList | null) => void;
  onRetryItem: (itemId: string) => void;
  onRunBatchUpload: () => void;
  onCancelBatchUpload: () => void;
  onClose: () => void;
}

export function UploadDialog({
  open,
  onOpenChange,
  orgId,
  kbId,
  uploadQueue,
  isBatchUploading,
  uploadErrors,
  uploadStats,
  uploaderRef,
  onSelectFiles,
  onRetryItem,
  onRunBatchUpload,
  onCancelBatchUpload,
  onClose,
}: UploadDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
          <DialogDescription>
            Select up to {UPLOAD_CONFIG.MAX_BATCH_SIZE} files. Maximum size per file:{' '}
            {UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-y-auto">
          <div className="space-y-2">
            <label htmlFor="file-upload" className="block text-sm font-medium text-foreground">
              Select Files
            </label>
            <input
              id="file-upload"
              type="file"
              multiple
              accept={UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(',')}
              onChange={(e) => onSelectFiles(e.target.files)}
              disabled={isBatchUploading}
              className="block w-full text-sm text-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 file:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground">
              Supported formats: {UPLOAD_CONFIG.ALLOWED_EXTENSIONS.join(', ')}
            </p>
          </div>

          <div className="hidden">
            {orgId && kbId && (
              <UploadFileToS3 ref={uploaderRef} prefix={`org_${orgId}/kb_${kbId}`} />
            )}
          </div>

          {uploadErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-medium mb-1">File validation errors:</p>
                <ul className="list-disc list-inside text-xs space-y-0.5">
                  {uploadErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {uploadQueue.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">
                  Upload Queue ({uploadStats.completed}/{uploadStats.total})
                </h3>
                {isBatchUploading && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Uploading...</span>
                  </div>
                )}
              </div>

              {isBatchUploading && (
                <div className="space-y-1">
                  <Progress value={uploadStats.avgProgress} className="h-2" />
                  <p className="text-xs text-muted-foreground text-center">
                    Overall Progress: {Math.round(uploadStats.avgProgress)}%
                  </p>
                </div>
              )}

              <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                {uploadQueue.map((item) => (
                  <UploadQueueItem
                    key={item.id}
                    item={item}
                    onRetry={onRetryItem}
                    isBatchUploading={isBatchUploading}
                  />
                ))}
              </div>

              {uploadStats.failed > 0 && !isBatchUploading && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">
                    {uploadStats.failed} file(s) failed to upload. You can retry individual files.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {isBatchUploading ? (
            <Button variant="destructive" onClick={onCancelBatchUpload}>
              <XCircle className="h-4 w-4 mr-2" />
              Cancel Upload
            </Button>
          ) : (
            <div className="space-x-2">
              <Button variant="outline" onClick={onClose} disabled={isBatchUploading}>
                Close
              </Button>

              <Button
                onClick={onRunBatchUpload}
                disabled={
                  !uploadQueue.length ||
                  isBatchUploading ||
                  uploadQueue.every((x) => x.status === 'completed')
                }
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload {uploadQueue.length > 0 ? `(${uploadQueue.length})` : ''}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
