'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, FileText, Upload, X, XCircle } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';

import { OpportunityItem } from '@auto-rfp/shared';
import { usePresignUpload } from '@/lib/hooks/use-presign';
import {
  useCreateQuestionFile,
  useQuestionFileStatus,
  useStartQuestionFilePipeline,
} from '@/lib/hooks/use-question-file';
import { useOrganization } from '@/context/organization-context';
import { useCreateOpportunity } from '@/lib/hooks/use-opportunities';

interface QuestionFileUploadDialogProps {
  projectId: string;
  triggerLabel?: string;
  onCompleted?: (questionFileId: string) => void;
}

type Step = 'idle' | 'uploading' | 'starting' | 'processing' | 'done' | 'error';

type UploadItem = {
  clientId: string;
  file: File;
  s3Key?: string;
  questionFileId?: string;
  step: Step;
  error?: string | null;
  updatedAt?: string;
  status?: string;
};

const VALID_EXTS = ['.pdf', '.doc', '.docx', '.txt'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const POLLING_INTERVAL = 2000; // 2 seconds

const isValidFile = (f: File): { valid: boolean; reason?: string } => {
  if (!VALID_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))) {
    return { valid: false, reason: 'Invalid file type' };
  }
  if (f.size > MAX_FILE_SIZE) {
    return { valid: false, reason: 'File too large (max 50MB)' };
  }
  return { valid: true };
};

const makeClientId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const isFinalStatus = (s?: string | null) =>
  s === 'PROCESSED' || s === 'FAILED' || s === 'DELETED';


// TODO Kate
export function QuestionFileUploadDialog({
                                           projectId,
                                           triggerLabel = 'Upload Document',
                                           onCompleted,
                                         }: QuestionFileUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const { currentOrganization } = useOrganization();

  const [items, setItems] = useState<UploadItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Use refs to track cleanup and latest state
  const mountedRef = useRef(true);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const itemsRef = useRef(items);
  const onCompletedRef = useRef(onCompleted);

  // Keep refs in sync
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  const { trigger: getPresignedUrl, isMutating: isGettingPresigned } = usePresignUpload();
  const { trigger: createQuestionFile } = useCreateQuestionFile(projectId, currentOrganization?.id);
  const { trigger: startPipeline, isMutating: isStartingPipeline } = useStartQuestionFilePipeline(projectId);
  const { trigger: createOpportunity, isMutating: isOppCreating } = useCreateOpportunity();

  const activeItem = items[activeIndex];
  const activeQuestionFileId = activeItem?.questionFileId ?? null;

  const {
    data: statusData,
    error: statusError,
    mutate: refetchStatus,
  } = useQuestionFileStatus(projectId, activeQuestionFileId);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
      }
    };
  }, []);

  const resetState = useCallback(() => {
    setItems([]);
    setActiveIndex(0);
    setError(null);
    setDragActive(false);
    setIsProcessing(false);
    if (pollingTimerRef.current) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  // Safe state updater that checks if component is mounted
  const safeSetItems = useCallback((updater: (prev: UploadItem[]) => UploadItem[]) => {
    if (!mountedRef.current) return;
    setItems(updater);
  }, []);

  // Handle status updates for active item (UPDATED FOR NEW STATUSES)
  useEffect(() => {
    if (!statusData || !activeItem || !mountedRef.current) return;

    const apiStatus = (statusData.status as string) ?? undefined;
    const updatedAt = statusData.updatedAt as string | undefined;

    const isDone = apiStatus === 'PROCESSED';
    const isFailed = apiStatus === 'FAILED';
    const isDeleted = apiStatus === 'DELETED';

    const isProcessingStatus =
      apiStatus === 'UPLOADED' ||
      apiStatus === 'PROCESSING' ||
      apiStatus === 'TEXTRACT_RUNNING' ||
      apiStatus === 'TEXT_READY';

    safeSetItems(prev => {
      const next = [...prev];
      const idx = next.findIndex(x => x.clientId === activeItem.clientId);
      if (idx === -1) return prev;

      if (isDone) {
        next[idx] = {
          ...next[idx],
          step: 'done',
          status: apiStatus,
          updatedAt,
          error: null,
        };

        if (onCompletedRef.current && next[idx].questionFileId) {
          try {
            onCompletedRef.current(next[idx].questionFileId!);
          } catch (err) {
            console.error('Error in onCompleted callback:', err);
          }
        }

        return next;
      }

      if (isFailed) {
        next[idx] = {
          ...next[idx],
          step: 'error',
          status: apiStatus,
          updatedAt,
          error: (statusData as any).errorMessage || 'Processing failed',
        };
        return next;
      }

      if (isDeleted) {
        next[idx] = {
          ...next[idx],
          step: 'error',
          status: apiStatus,
          updatedAt,
          error: 'File was deleted',
        };
        return next;
      }

      // default: keep as processing for intermediate/unknown statuses
      next[idx] = {
        ...next[idx],
        step: isProcessingStatus ? 'processing' : next[idx].step,
        status: apiStatus,
        updatedAt,
        error: null,
      };

      return next;
    });
  }, [statusData, activeItem, safeSetItems]);

  // Handle status errors
  useEffect(() => {
    if (!statusError || !mountedRef.current) return;

    if (activeItem) {
      safeSetItems(prev => {
        const next = [...prev];
        const idx = next.findIndex(x => x.clientId === activeItem.clientId);
        if (idx === -1) return prev;
        next[idx] = {
          ...next[idx],
          step: 'error',
          error: statusError.message || 'Failed to check processing status',
        };
        return next;
      });
    } else {
      setError(statusError.message || 'Failed to check processing status');
    }
  }, [statusError, activeItem, safeSetItems]);

  // Polling logic with proper cleanup (STOPS ON FINAL STATUSES)
  useEffect(() => {
    if (!activeQuestionFileId || !mountedRef.current) {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      return;
    }

    const currentStatus = statusData?.status as string | undefined;

    if (activeItem?.step !== 'processing' || isFinalStatus(currentStatus)) {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      return;
    }

    const poll = () => {
      if (!mountedRef.current) return;
      refetchStatus();
      pollingTimerRef.current = setTimeout(poll, POLLING_INTERVAL);
    };

    poll();

    return () => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [activeQuestionFileId, activeItem?.step, refetchStatus, statusData?.status]);

  const anyBusy = useMemo(
    () => isGettingPresigned || isStartingPipeline || isProcessing,
    [isGettingPresigned, isStartingPipeline, isProcessing]
  );

  const handleClose = () => {
    if (!anyBusy) {
      window.location.reload();
    }
  };

  const addFiles = useCallback((fileList: FileList | File[]) => {
    setError(null);

    const incoming = Array.from(fileList);
    const validFiles: File[] = [];
    const errors: string[] = [];

    incoming.forEach(file => {
      const validation = isValidFile(file);
      if (validation.valid) {
        validFiles.push(file);
      } else {
        errors.push(`${file.name}: ${validation.reason}`);
      }
    });

    if (errors.length > 0) {
      setError(`Some files were skipped:\n${errors.join('\n')}`);
    }

    if (validFiles.length === 0) return;

    setItems(prev => {
      const newItems = validFiles.map(file => ({
        clientId: makeClientId(),
        file,
        step: 'idle' as Step,
        error: null,
      }));
      return [...prev, ...newItems];
    });

    setActiveIndex(prev => (items.length === 0 ? 0 : prev));
  }, [items.length]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    addFiles(e.target.files);
    e.target.value = '';
  }, [addFiles]);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleRemoveItem = useCallback((clientId: string) => {
    setError(null);
    setItems(prev => {
      const idx = prev.findIndex(x => x.clientId === clientId);
      const next = prev.filter(x => x.clientId !== clientId);

      setActiveIndex(current => {
        if (next.length === 0) return 0;
        if (current > next.length - 1) return next.length - 1;
        if (idx !== -1 && current === idx) return Math.max(0, Math.min(idx, next.length - 1));
        if (idx !== -1 && idx < current) return current - 1;
        return current;
      });

      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    if (anyBusy) return;
    resetState();
  }, [anyBusy, resetState]);

  const setItemStep = useCallback((clientId: string, patch: Partial<UploadItem>) => {
    safeSetItems(prev => {
      const next = [...prev];
      const idx = next.findIndex(x => x.clientId === clientId);
      if (idx === -1) return prev;
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, [safeSetItems]);

  const processOne = useCallback(async (item: UploadItem, oppId: string) => {
    if (!mountedRef.current) throw new Error('Component unmounted');

    setItemStep(item.clientId, { error: null, step: 'uploading' });

    try {
      // 1) Get presigned URL
      const presigned = await getPresignedUrl({
        fileName: item.file.name,
        contentType: item.file.type || 'application/octet-stream',
      });

      if (!mountedRef.current) throw new Error('Component unmounted');

      // 2) Upload to S3
      const uploadRes = await fetch(presigned.url, {
        method: 'PUT',
        body: item.file,
        headers: {
          'Content-Type': item.file.type || 'application/octet-stream',
        },
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => '');
        throw new Error(text || `Failed to upload ${item.file.name} to S3`);
      }

      if (!mountedRef.current) throw new Error('Component unmounted');

      // 3) Create record
      const created = await createQuestionFile({
        originalFileName: item.file.name,
        fileKey: presigned.key,
        mimeType: item.file.type,
      });

      const qfId = created.questionFileId as string;

      if (!mountedRef.current) throw new Error('Component unmounted');

      setItemStep(item.clientId, {
        s3Key: presigned.key,
        questionFileId: qfId,
        step: 'starting',
      });

      // 4) Start pipeline
      await startPipeline({
        projectId,
        oppId,
        questionFileId: qfId,
      });

      if (!mountedRef.current) throw new Error('Component unmounted');

      // 5) Start polling / show processing
      setItemStep(item.clientId, { step: 'processing' });
    } catch (err) {
      if (!mountedRef.current) return;
      throw err;
    }
  }, [getPresignedUrl, createQuestionFile, startPipeline, projectId, setItemStep]);

  const handleStart = useCallback(async () => {
    if (items.length === 0) {
      setError('Please select at least one file.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Process files sequentially
      const { oppId } = await createOpportunity({} as OpportunityItem);
      for (let idx = 0; idx < itemsRef.current.length; idx++) {
        if (!mountedRef.current) break;

        const item = itemsRef.current[idx];

        // Skip already processed or currently processing files
        if (item.step !== 'idle' && item.step !== 'error') continue;

        setActiveIndex(idx);

        try {
          await processOne(item, oppId);

          // Wait for processing to complete before moving to next
          await new Promise<void>((resolve) => {
            const checkCompletion = () => {
              const currentItem = itemsRef.current[idx];
              if (!currentItem || !mountedRef.current) {
                resolve();
                return;
              }

              if (currentItem.step === 'done' || currentItem.step === 'error') {
                resolve();
              } else {
                setTimeout(checkCompletion, 500);
              }
            };
            checkCompletion();
          });
        } catch (err: any) {
          console.error('Upload/start error', err);
          if (mountedRef.current) {
            setItemStep(item.clientId, {
              step: 'error',
              error: err?.message || 'Unexpected error'
            });
          }
        }
      }
    } catch (err: any) {
      console.error('Batch start error', err);
      if (mountedRef.current) {
        setError(err?.message || 'Unexpected error');
      }
    } finally {
      if (mountedRef.current) {
        setIsProcessing(false);
      }
    }
  }, [items.length, processOne, setItemStep]);

  const allDone = items.length > 0 && items.every(i => i.step === 'done');
  const hasErrors = items.some(i => i.step === 'error');
  const activeStep = activeItem?.step ?? 'idle';

  // Better progress mapping using backend statuses when available
  const progressValue = useMemo(() => {
    const s = statusData?.status as string | undefined;

    if (s === 'UPLOADED') return 35;
    if (s === 'PROCESSING') return 55;
    if (s === 'TEXTRACT_RUNNING') return 65;
    if (s === 'TEXT_READY') return 85;
    if (s === 'PROCESSED') return 100;
    if (s === 'FAILED' || s === 'DELETED') return 0;

    switch (activeStep) {
      case 'idle':
        return 0;
      case 'uploading':
        return 25;
      case 'starting':
        return 50;
      case 'processing':
        return 75;
      case 'done':
        return 100;
      case 'error':
        return 0;
      default:
        return 0;
    }
  }, [activeStep, statusData?.status]);

  const statusLabel = useMemo(() => {
    if (!activeItem) return items.length ? 'Ready to process' : 'Ready to upload';
    if (activeItem.error) return 'Error';

    switch (statusData?.status as string | undefined) {
      case 'UPLOADED':
        return 'Uploaded, waiting to start';
      case 'PROCESSING':
        return 'Processing document';
      case 'TEXTRACT_RUNNING':
        return 'Textract running';
      case 'TEXT_READY':
        return 'Text ready';
      case 'PROCESSED':
        return 'Completed';
      case 'FAILED':
        return 'Error';
      case 'DELETED':
        return 'Deleted';
      default:
        break;
    }

    switch (activeStep) {
      case 'uploading':
        return 'Uploading file';
      case 'starting':
        return 'Initializing pipeline';
      case 'processing':
        return 'Processing document';
      case 'done':
        return 'Completed';
      default:
        return 'Ready to upload';
    }
  }, [activeItem, statusData, activeStep, items.length]);

  const StatusIcon = useMemo(() => {
    if (activeStep === 'done') return CheckCircle2;
    if (activeStep === 'error') return XCircle;
    if (['uploading', 'starting', 'processing'].includes(activeStep)) return Clock;
    return AlertCircle;
  }, [activeStep]);

  const completedCount = items.filter(i => i.step === 'done').length;

  return (
    <Dialog
      open={open}
      onOpenChange={(flag) => {
        if (!flag && !anyBusy) {
          handleClose();
        }
        setOpen(flag);
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2 px-6 py-2.5 font-medium">
          <Upload className="h-4 w-4" aria-hidden="true"/>
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl" aria-describedby="upload-dialog-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-5 w-5" aria-hidden="true"/>
            Upload Question Files
          </DialogTitle>
          <DialogDescription id="upload-dialog-description">
            Upload files to extract questions for analysis (PDF/DOC/DOCX/TXT, max 50MB each)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* File Upload Area */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-semibold text-foreground">
                Select Documents
              </label>
              <div className="flex items-center gap-2">
                {items.length > 0 && (
                  <Badge variant="secondary" className="font-medium">
                    {completedCount}/{items.length} completed
                  </Badge>
                )}
                {items.length > 0 && !anyBusy && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearAll}
                    className="h-8"
                    aria-label="Clear all files"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            <div
              className={`relative border-2 border-dashed rounded-lg p-6 transition-all ${
                dragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-muted-foreground/50'
              } ${anyBusy ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              role="button"
              aria-label="Upload files"
              tabIndex={anyBusy ? -1 : 0}
            >
              <input
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                multiple
                onChange={handleFileChange}
                disabled={anyBusy}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                aria-label="File upload input"
              />
              <div className="flex flex-col items-center justify-center space-y-3 text-center">
                <div className="p-4 bg-primary/10 rounded-full">
                  <Upload className="h-8 w-8 text-primary" aria-hidden="true"/>
                </div>
                <div>
                  <p className="text-sm font-medium">
                    Drop files here, or <span className="text-primary">browse</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports PDF/DOC/DOCX/TXT (max 50MB each)
                  </p>
                </div>
              </div>
            </div>

            {/* Selected Files List */}
            {items.length > 0 && (
              <div className="space-y-2" role="list" aria-label="Selected files">
                {items.map((it, idx) => {
                  const isActive = idx === activeIndex;
                  const ItemIcon =
                    it.step === 'done' ? CheckCircle2 :
                      it.step === 'error' ? XCircle :
                        ['uploading', 'starting', 'processing'].includes(it.step) ? Clock :
                          FileText;

                  return (
                    <div
                      key={it.clientId}
                      role="listitem"
                      className={`border rounded-lg p-3 transition ${
                        isActive ? 'border-primary/60 bg-primary/5' : 'border-muted'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded ${isActive ? 'bg-primary/10' : 'bg-muted'}`}>
                          <ItemIcon
                            className={`h-5 w-5 ${
                              it.step === 'done' ? 'text-green-600' :
                                it.step === 'error' ? 'text-destructive' :
                                  ['uploading', 'starting', 'processing'].includes(it.step) ? 'text-primary animate-pulse' :
                                    'text-muted-foreground'
                            }`}
                            aria-hidden="true"
                          />
                        </div>

                        <button
                          type="button"
                          className="flex-1 min-w-0 text-left"
                          onClick={() => setActiveIndex(idx)}
                          disabled={anyBusy}
                          aria-label={`Select ${it.file.name}`}
                        >
                          <p className="text-sm font-medium truncate">{it.file.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {(it.file.size / 1024 / 1024).toFixed(2)} MB
                            {it.questionFileId && ` • ID: ${it.questionFileId}`}
                          </p>
                          {it.status && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Status: <span className="font-medium">{it.status}</span>
                            </p>
                          )}
                          {it.error && (
                            <p className="text-xs text-destructive mt-1" role="alert">
                              {it.error}
                            </p>
                          )}
                        </button>

                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              it.step === 'done' ? 'default' :
                                it.step === 'error' ? 'destructive' :
                                  'secondary'
                            }
                            className="font-medium"
                          >
                            {it.step === 'idle' ? 'Queued' : it.step}
                          </Badge>

                          {!anyBusy && it.step !== 'done' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveItem(it.clientId)}
                              className="shrink-0 h-8 w-8 p-0"
                              aria-label={`Remove ${it.file.name}`}
                            >
                              <X className="h-4 w-4" aria-hidden="true"/>
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Progress Section */}
          {activeItem && (activeItem.step !== 'idle' || activeItem.questionFileId) && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg" role="region" aria-label="Processing status">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusIcon
                    className={`h-4 w-4 ${
                      activeStep === 'done' ? 'text-green-600' :
                        activeStep === 'error' ? 'text-destructive' :
                          'text-primary animate-pulse'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm font-semibold">
                    Processing Status
                  </span>
                </div>
                <Badge
                  variant={
                    activeStep === 'done' ? 'default' :
                      activeStep === 'error' ? 'destructive' :
                        'secondary'
                  }
                  className="font-medium"
                >
                  {statusLabel}
                </Badge>
              </div>

              <div className="space-y-2">
                <Progress value={progressValue} className="h-2" aria-label="Upload progress"/>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{progressValue}% complete</span>
                  {(statusData?.updatedAt || activeItem.updatedAt) && (
                    <span>
                      Updated{' '}
                      {new Date((statusData?.updatedAt || activeItem.updatedAt) as string).toLocaleTimeString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Step Indicators */}
              <div className="grid grid-cols-4 gap-2 pt-2">
                {[
                  { label: 'Upload', value: 25 },
                  { label: 'Initialize', value: 50 },
                  { label: 'Process', value: 75 },
                  { label: 'Complete', value: 100 },
                ].map((s, i) => (
                  <div key={i} className="flex flex-col items-center gap-1">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        progressValue >= s.value ? 'bg-primary' : 'bg-muted-foreground/20'
                      }`}
                      aria-hidden="true"
                    />
                    <span
                      className={`text-xs ${
                        progressValue >= s.value ? 'text-foreground font-medium' : 'text-muted-foreground'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              {activeItem.questionFileId && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">File ID:</span> {activeItem.questionFileId}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive" role="alert">
              <XCircle className="h-4 w-4" aria-hidden="true"/>
              <AlertDescription className="text-sm whitespace-pre-line">
                <span className="font-medium">Error:</span> {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Success Alert */}
          {allDone && (
            <Alert className="border-green-600/50 bg-green-50 dark:bg-green-950/20" role="alert">
              <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true"/>
              <AlertDescription className="text-sm text-green-900 dark:text-green-100">
                <span className="font-medium">Success!</span> All documents have been processed.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={anyBusy && !allDone}
          >
            {allDone ? 'Done' : 'Cancel'}
          </Button>

          <Button
            type="button"
            onClick={handleStart}
            disabled={items.length === 0 || anyBusy || allDone}
            className="gap-2 min-w-[160px]"
          >
            {anyBusy ? (
              <>
                <Clock className="h-4 w-4 animate-spin" aria-hidden="true"/>
                Processing…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" aria-hidden="true"/>
                {hasErrors ? 'Retry Failed' : 'Start Processing'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}