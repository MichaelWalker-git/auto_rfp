'use client';

import React, {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/use-toast';
import { Upload, X, AlertCircle } from 'lucide-react';
import { usePresignUpload } from '@/lib/hooks/use-presign';

// ============================================================================
// TYPES
// ============================================================================

export type UploadResult = {
  fileKey: string;
  fileId: string;
  sortKey: string;
  fileName: string;
};

export type UploadFileToS3Ref = {
  upload: (file: File) => Promise<UploadResult>;
  reset: () => void;
  abort: () => void;
};

type Props = {
  prefix?: string;
  accept?: string;
  disabled?: boolean;
  buttonLabel?: string;
  showProgress?: boolean;
  autoReset?: boolean;
  onUploaded?: (result: UploadResult) => void;
  onError?: (err: unknown) => void;
  onProgressChange?: (progress: number) => void;
};

// ============================================================================
// UPLOAD UTILITIES
// ============================================================================

interface XhrUploadOptions {
  url: string;
  method?: string;
  file: File;
  onProgress: (pct: number) => void;
  signal?: AbortSignal;
  contentType?: string;
}

function xhrUploadWithProgress(opts: XhrUploadOptions): Promise<void> {
  const { url, method = 'PUT', file, onProgress, signal, contentType } = opts;

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let isAborted = false;

    const abortHandler = () => {
      isAborted = true;
      try {
        xhr.abort();
      } catch (err) {
        console.error('Error aborting XHR:', err);
      }
      reject(new Error('Upload aborted by user'));
    };

    // Handle abort signal
    if (signal) {
      if (signal.aborted) {
        return abortHandler();
      }
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    // Upload progress tracking
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      onProgress(pct);
    };

    // Success handler
    xhr.onload = () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(
          new Error(
            `Upload failed with status ${xhr.status}: ${xhr.statusText || 'Unknown error'}`
          )
        );
      }
    };

    // Network error handler
    xhr.onerror = () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }

      if (!isAborted) {
        reject(new Error('Network error occurred during upload'));
      }
    };

    // Timeout handler
    xhr.ontimeout = () => {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      reject(new Error('Upload timed out'));
    };

    try {
      xhr.open(method, url);

      // Set timeout (5 minutes for large files)
      xhr.timeout = 5 * 60 * 1000;

      // Set content type header
      const finalContentType = contentType || file.type || 'application/octet-stream';
      xhr.setRequestHeader('Content-Type', finalContentType);

      xhr.send(file);
    } catch (err) {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
      reject(err);
    }
  });
}

// ============================================================================
// COMPONENT
// ============================================================================

export const UploadFileToS3 = forwardRef<UploadFileToS3Ref, Props>(
  (
    {
      prefix,
      accept,
      disabled = false,
      buttonLabel = 'Upload file',
      showProgress = true,
      autoReset = false,
      onUploaded,
      onError,
      onProgressChange,
    },
    ref
  ) => {
    // Refs
    const inputRef = useRef<HTMLInputElement | null>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // State
    const [fileName, setFileName] = useState<string | null>(null);
    const [fileSize, setFileSize] = useState<number>(0);
    const [progress, setProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);

    // Hooks
    const { trigger: presign, isMutating: isSigning, error: presignError } = usePresignUpload();

    const isBusy = disabled || isSigning || isUploading;

    // ============================================================================
    // HANDLERS
    // ============================================================================

    const reset = useCallback(() => {
      setFileName(null);
      setFileSize(0);
      setProgress(0);
      setIsUploading(false);
      setUploadError(null);
      abortControllerRef.current = null;

      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }, []);

    const abort = useCallback(() => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        setIsUploading(false);
        setUploadError('Upload cancelled');

        toast({
          title: 'Upload cancelled',
          description: fileName || 'File upload was cancelled',
        });
      }
    }, [fileName]);

    const handleProgressChange = useCallback(
      (pct: number) => {
        setProgress(pct);
        onProgressChange?.(pct);
      },
      [onProgressChange]
    );

    const upload = useCallback(
      async (file: File): Promise<UploadResult> => {
        if (!file) {
          throw new Error('No file provided');
        }

        // Reset previous state
        setFileName(file.name);
        setFileSize(file.size);
        setProgress(0);
        setIsUploading(true);
        setUploadError(null);

        // Abort any existing upload
        abortControllerRef.current?.abort();
        abortControllerRef.current = new AbortController();

        try {
          // Step 1: Get presigned URL
          handleProgressChange(5);

          const presigned = await presign({
            fileName: file.name,
            contentType: file.type || 'application/octet-stream',
            prefix,
          });

          if (!presigned?.url || !presigned?.key) {
            throw new Error('Invalid presign response: missing url or key');
          }

          handleProgressChange(10);

          // Step 2: Upload to S3
          await xhrUploadWithProgress({
            url: presigned.url,
            method: presigned.method || 'PUT',
            file,
            contentType: file.type || 'application/octet-stream',
            onProgress: (pct) => {
              // Map progress from 10% to 95% (leave 5% for final processing)
              const mappedProgress = 10 + (pct * 0.85);
              handleProgressChange(Math.round(mappedProgress));
            },
            signal: abortControllerRef.current.signal,
          });

          // Step 3: Construct result
          handleProgressChange(100);

          const result: UploadResult = {
            fileKey: presigned.key,
            fileId: presigned.file?.fileId ?? '',
            sortKey: presigned.file?.sortKey ?? '',
            fileName: file.name,
          };

          // Success callback
          onUploaded?.(result);

          toast({
            title: 'Upload complete',
            description: `${file.name} uploaded successfully`,
          });

          // Auto reset if enabled
          if (autoReset) {
            setTimeout(reset, 2000);
          }

          return result;
        } catch (err: any) {
          const errorMessage = err?.message || 'Unknown upload error';
          setUploadError(errorMessage);

          // Error callback
          onError?.(err);

          toast({
            variant: 'destructive',
            title: 'Upload failed',
            description: errorMessage,
          });

          throw err;
        } finally {
          setIsUploading(false);
        }
      },
      [
        onError,
        onUploaded,
        prefix,
        presign,
        autoReset,
        reset,
        handleProgressChange,
      ]
    );

    // Expose imperative methods
    useImperativeHandle(ref, () => ({ upload, reset, abort }), [upload, reset, abort]);

    // ============================================================================
    // FILE SELECTION HANDLER
    // ============================================================================

    const onPickFile = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
          await upload(file);
        } catch (err) {
          console.error('Upload error:', err);
        } finally {
          // Allow selecting the same file again
          e.currentTarget.value = '';
        }
      },
      [upload]
    );

    // ============================================================================
    // RENDER
    // ============================================================================

    const formatBytes = (bytes: number): string => {
      if (bytes === 0) return '0 Bytes';
      const k = 1024;
      const sizes = ['Bytes', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    return (
      <div className="space-y-3">
        {/* Hidden file input */}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={onPickFile}
          className="hidden"
          disabled={isBusy}
          aria-label="File upload input"
        />

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
            aria-busy={isBusy}
          >
            <Upload className="h-4 w-4 mr-2" />
            {isSigning
              ? 'Preparing...'
              : isUploading
                ? 'Uploading...'
                : buttonLabel}
          </Button>

          {isUploading && (
            <Button
              type="button"
              variant="outline"
              onClick={abort}
              aria-label="Cancel upload"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}

          {(fileName || progress > 0) && !isUploading && (
            <Button
              type="button"
              variant="ghost"
              onClick={reset}
              disabled={isUploading}
              aria-label="Reset upload"
            >
              Reset
            </Button>
          )}
        </div>

        {/* File info and progress */}
        {fileName && (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" title={fileName}>
                  {fileName}
                </p>
                {fileSize > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(fileSize)}
                  </p>
                )}
              </div>

              {progress === 100 && !uploadError && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex-shrink-0">
                  Complete
                </span>
              )}
            </div>

            {showProgress && (progress > 0 || isUploading) && (
              <div className="space-y-1">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {progress}%
                </p>
              </div>
            )}
          </div>
        )}

        {/* Error display */}
        {uploadError && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Upload failed</p>
              <p className="text-xs mt-0.5">{uploadError}</p>
            </div>
          </div>
        )}

        {/* Presign error display */}
        {presignError && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">Preparation failed</p>
              <p className="text-xs mt-0.5">{presignError.message}</p>
            </div>
          </div>
        )}
      </div>
    );
  }
);

UploadFileToS3.displayName = 'UploadFileToS3';