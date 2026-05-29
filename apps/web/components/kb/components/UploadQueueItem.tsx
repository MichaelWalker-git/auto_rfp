'use client';

import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AlertCircle, CheckCircle2, FileText, Loader2, RotateCw, XCircle } from 'lucide-react';
import { UploadQueueItem as UploadQueueItemType, UPLOAD_CONFIG } from '../lib/upload-config';
import { formatFileSize } from '../lib/formatting';

interface UploadQueueItemProps {
  item: UploadQueueItemType;
  onRetry: (itemId: string) => void;
  isBatchUploading: boolean;
}

export function UploadQueueItem({ item, onRetry, isBatchUploading }: UploadQueueItemProps) {
  return (
    <div className="flex items-start gap-3 p-3 border rounded-md bg-card hover:bg-muted/50 transition-colors">
      <div className="mt-0.5">
        {item.status === 'completed' && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
        {item.status === 'failed' && <XCircle className="h-5 w-5 text-red-500" />}
        {(item.status === 'uploading' || item.status === 'processing') && (
          <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
        )}
        {item.status === 'queued' && <FileText className="h-5 w-5 text-muted-foreground" />}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{item.fileName}</p>
            <p className="text-xs text-muted-foreground">{formatFileSize(item.file.size)}</p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {item.status === 'failed' && item.retryCount < UPLOAD_CONFIG.MAX_RETRY_ATTEMPTS && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRetry(item.id)}
                disabled={isBatchUploading}
              >
                <RotateCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            )}
          </div>
        </div>

        {(item.status === 'uploading' || item.status === 'processing') && (
          <Progress value={item.progress} className="h-1.5" />
        )}

        {item.error && (
          <p className="text-xs text-red-500 flex items-start gap-1">
            <AlertCircle className="h-3 w-3 mt-0.5 flex-shrink-0" />
            <span>{item.error}</span>
          </p>
        )}

        {item.status === 'completed' && (
          <p className="text-xs text-emerald-600 dark:text-emerald-400">Successfully uploaded</p>
        )}
      </div>
    </div>
  );
}
