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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CancelPipelineButton } from '@/components/cancel-pipeline-button';

import type { OpportunityItem } from '@auto-rfp/shared';
import { usePresignUpload } from '@/lib/hooks/use-presign';
import {
  useCreateQuestionFile,
  useQuestionFilesStatus,
  useStartQuestionFilePipeline,
} from '@/lib/hooks/use-question-file';
import { useCurrentOrganization } from '@/context/organization-context';
import { useCreateOpportunity } from '@/lib/hooks/use-opportunities';

interface QuestionFileUploadDialogProps {
  projectId: string;
  oppId?: string;
  triggerLabel?: string;
  onCompleted?: (questionFileId: string) => void;
}

type Step = 'idle' | 'uploading' | 'starting' | 'processing' | 'done' | 'error' | 'cancelled';

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
const MAX_FILE_SIZE = 50 * 1024 * 1024;

const isValidFile = (f: File): { valid: boolean; reason?: string } => {
  if (!VALID_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext))) {
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

export function QuestionFileUploadDialog({
                                           projectId,
                                           triggerLabel = 'Upload Documents',
                                           onCompleted,
                                           oppId: oppIdParam,
                                         }: QuestionFileUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const { currentOrganization } = useCurrentOrganization();

  const [items, setItems] = useState<UploadItem[]>([]);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchOppId, setBatchOppId] = useState<string | undefined>(oppIdParam);

  const mountedRef = useRef(true);
  const itemsRef = useRef(items);
  const onCompletedRef = useRef(onCompleted);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    onCompletedRef.current = onCompleted;
  }, [onCompleted]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { trigger: getPresignedUrl, isMutating: isGettingPresigned } = usePresignUpload();
  const { trigger: createQuestionFile } = useCreateQuestionFile(projectId, currentOrganization?.id);
  const { trigger: startPipeline, isMutating: isStartingPipeline } = useStartQuestionFilePipeline();
  const { trigger: createOpportunity } = useCreateOpportunity();

  const processingQuestionFileIds = useMemo(
    () =>
      items
        .filter((item) => item.questionFileId && (item.step === 'processing' || item.step === 'cancelled'))
        .map((item) => item.questionFileId!),
    [items],
  );

  const { data: allStatuses, mutate: refetchStatuses } = useQuestionFilesStatus(projectId, batchOppId || oppIdParam || '', processingQuestionFileIds);

  useEffect(() => {
    if (!allStatuses) return;

    allStatuses.forEach(({ questionFileId, data: statusData }) => {
      if (!statusData) return;

      const apiStatus = (statusData.status as string) ?? undefined;
      const updatedAt = statusData.updatedAt as string | undefined;

      setItems((prev) => {
        const next = [...prev];
        const idx = next.findIndex((x) => x.questionFileId === questionFileId);
        if (idx === -1) return prev;

        const current = next[idx];
        if (current.status === apiStatus && current.updatedAt === updatedAt) return prev;

        if (apiStatus === 'PROCESSED') {
          next[idx] = { ...current, step: 'done', status: apiStatus, updatedAt, error: null };
          if (onCompletedRef.current && next[idx].questionFileId) {
            try {
              onCompletedRef.current(next[idx].questionFileId!);
            } catch (e) {
              console.error('onCompleted callback error', e);
            }
          }
          return next;
        }

        if (apiStatus === 'CANCELLED') {
          next[idx] = {
            ...current,
            step: 'cancelled',
            status: apiStatus,
            updatedAt,
            error: 'Cancelled by user',
          };
          return next;
        }

        if (apiStatus === 'FAILED') {
          next[idx] = {
            ...current,
            step: 'error',
            status: apiStatus,
            updatedAt,
            error: (statusData as any).errorMessage || 'Processing failed',
          };
          return next;
        }

        if (apiStatus === 'DELETED') {
          return prev.filter((x) => x.questionFileId !== questionFileId);
        }

        const isProcessingStatus =
          apiStatus === 'UPLOADED' ||
          apiStatus === 'PROCESSING' ||
          apiStatus === 'TEXTRACT_RUNNING' ||
          apiStatus === 'TEXT_READY';

        next[idx] = {
          ...current,
          step: isProcessingStatus ? 'processing' : current.step,
          status: apiStatus,
          updatedAt,
          error: null,
        };

        return next;
      });
    });
  }, [allStatuses]);

  const resetState = useCallback(() => {
    setItems([]);
    setActiveIndex(0);
    setError(null);
    setDragActive(false);
    setIsProcessing(false);
    setBatchOppId(undefined);
  }, []);

  useEffect(() => {
    if (!open) resetState();
  }, [open, resetState]);

  const activeItem = items[activeIndex];
  const activeStep = activeItem?.step ?? 'idle';

  const allDone = items.length > 0 && items.every((i) => i.step === 'done');
  const hasErrors = items.some((i) => i.step === 'error');
  const completedCount = items.filter((i) => i.step === 'done').length;
  const hasProcessableItems = items.some((i) => i.step === 'idle' || i.step === 'error');

  const anyBusy = useMemo(() => {
    if (isGettingPresigned || isStartingPipeline || isProcessing) return true;
    return items.some((item) => item.step === 'uploading' || item.step === 'starting' || item.step === 'processing');
  }, [isGettingPresigned, isStartingPipeline, isProcessing, items]);

  const handleClose = () => {
    window.location.reload();
  };

  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      setError(null);

      const incoming = Array.from(fileList);
      const validFiles: File[] = [];
      const errors: string[] = [];

      incoming.forEach((file) => {
        const v = isValidFile(file);
        if (v.valid) validFiles.push(file);
        else errors.push(`${file.name}: ${v.reason}`);
      });

      if (errors.length > 0) setError(`Some files were skipped:\n${errors.join('\n')}`);
      if (validFiles.length === 0) return;

      setItems((prev) => {
        const newItems = validFiles.map((file) => ({
          clientId: makeClientId(),
          file,
          step: 'idle' as Step,
          error: null,
        }));
        return [...prev, ...newItems];
      });

      setActiveIndex((prevIdx) => (itemsRef.current.length === 0 ? 0 : prevIdx));
    },
    [],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      addFiles(e.target.files);
      e.target.value = '';
    },
    [addFiles],
  );

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files?.length > 0) addFiles(e.dataTransfer.files);
    },
    [addFiles],
  );

  const handleRemoveItem = useCallback((clientId: string) => {
    setError(null);
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.clientId === clientId);
      const next = prev.filter((x) => x.clientId !== clientId);

      setActiveIndex((current) => {
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
    setItems((prev) => {
      const next = [...prev];
      const idx = next.findIndex((x) => x.clientId === clientId);
      if (idx === -1) return prev;
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }, []);

  const processOne = useCallback(
    async (item: UploadItem, oppId: string) => {
      setItemStep(item.clientId, { error: null, step: 'uploading' });

      const presigned = await getPresignedUrl({
        fileName: item.file.name,
        contentType: item.file.type || 'application/octet-stream',
      });

      const uploadRes = await fetch(presigned.url, {
        method: 'PUT',
        body: item.file,
        headers: { 'Content-Type': item.file.type || 'application/octet-stream' },
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => '');
        throw new Error(text || `Failed to upload ${item.file.name} to S3`);
      }

      const created = await createQuestionFile({
        projectId,
        oppId,
        originalFileName: item.file.name,
        fileKey: presigned.key,
        mimeType: item.file.type,
      });

      const qfId = (created as any).questionFileId as string;

      setItemStep(item.clientId, {
        s3Key: presigned.key,
        questionFileId: qfId,
        step: 'starting',
      });

      await startPipeline({ projectId, oppId, questionFileId: qfId });

      setItemStep(item.clientId, { step: 'processing' });
    },
    [createQuestionFile, getPresignedUrl, projectId, setItemStep, startPipeline],
  );

  const handleStart = useCallback(async () => {
    if (items.length === 0) {
      setError('Please select at least one file.');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      let localOppId = batchOppId;
      if (!oppIdParam && !batchOppId && !localOppId) {
        const timestamp = Date.now();
        const opportunityData: OpportunityItem = {
          source: 'MANUAL_UPLOAD' as const,
          id: `BATCH_${timestamp}`,
          title: `Batch Upload - ${new Date().toLocaleDateString()} (${items.length} files)`,
          active: true,

          orgId: currentOrganization?.id,
          projectId,
          type: 'Combined Synopsis/Solicitation',
          postedDateIso: new Date().toISOString(),
          responseDeadlineIso: null,
          noticeId: `BATCH_${timestamp}`,
          solicitationNumber: `BATCH-${timestamp}`,
          naicsCode: null,
          pscCode: null,
          organizationName: currentOrganization?.name || null,
          organizationCode: null,
          setAside: null,
          setAsideCode: null,
          description: `Batch document upload containing ${items.length} file(s)`,
          baseAndAllOptionsValue: null,
        };
        const { oppId } = await createOpportunity(opportunityData);
        localOppId = oppId;
        setBatchOppId(oppId);
      }

      for (let idx = 0; idx < itemsRef.current.length; idx++) {
        const item = itemsRef.current[idx];
        if (item.step !== 'idle' && item.step !== 'error') continue;

        setActiveIndex(idx);

        try {
          await processOne(item, localOppId || batchOppId || oppIdParam || '');
        } catch (err: any) {
          console.error('Upload/start error', err);
          if (mountedRef.current) {
            setItemStep(item.clientId, { step: 'error', error: err?.message || 'Unexpected error' });
          }
        }
      }
    } catch (err: any) {
      console.error('Batch start error', err);
      if (mountedRef.current) setError(err?.message || 'Unexpected error');
    } finally {
      setIsProcessing(false);
    }
  }, [batchOppId, createOpportunity, currentOrganization, items.length, processOne, projectId, setItemStep]);

  const StatusIcon = useMemo(() => {
    if (activeStep === 'done') return CheckCircle2;
    if (activeStep === 'error') return XCircle;
    if (['uploading', 'starting', 'processing'].includes(activeStep)) return Clock;
    return AlertCircle;
  }, [activeStep]);

  return (
    <Dialog
      open={open}
      onOpenChange={(flag) => {
        if (!flag && !anyBusy) handleClose();
        setOpen(flag);
      }}
    >
      <DialogTrigger asChild>
        <Button className="gap-2 px-6 py-2.5 font-medium">
          <Upload className="h-4 w-4" aria-hidden="true"/>
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] flex flex-col"
        aria-describedby="upload-dialog-description"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-5 w-5" aria-hidden="true"/>
            Upload Question Files
          </DialogTitle>
          <DialogDescription id="upload-dialog-description">
            Upload files to extract questions for analysis (PDF/DOC/DOCX, max 50MB each)
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 flex-1 overflow-y-auto pr-2">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-semibold text-foreground">Select Documents</label>
              <div className="flex items-center gap-2">
                {items.length > 0 && !anyBusy && (
                  <Button variant="ghost" size="sm" onClick={handleClearAll} className="h-8"
                          aria-label="Clear all files">
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {!anyBusy && (
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
                    <p className="text-xs text-muted-foreground mt-1">Supports PDF/DOC/DOCX (max 50MB each)</p>
                  </div>
                </div>
              </div>
            )}

            {items.length > 0 && (
              <div className="space-y-2" role="list" aria-label="Selected files">
                {items.map((it, idx) => {
                  const isActive = idx === activeIndex;
                  const ItemIcon =
                    it.step === 'done'
                      ? CheckCircle2
                      : it.step === 'error'
                        ? XCircle
                        : ['uploading', 'starting', 'processing'].includes(it.step)
                          ? Clock
                          : FileText;

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
                              it.step === 'done'
                                ? 'text-green-600'
                                : it.step === 'error'
                                  ? 'text-destructive'
                                  : ['uploading', 'starting', 'processing'].includes(it.step)
                                    ? 'text-primary animate-pulse'
                                    : 'text-muted-foreground'
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
                            variant={it.step === 'done' ? 'default' : it.step === 'error' ? 'destructive' : 'secondary'}
                            className="font-medium"
                          >
                            {it.step === 'idle' ? 'Queued' : it.step}
                          </Badge>

                          {!anyBusy && it.step !== 'done' && it.step !== 'cancelled' && (
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

                          {(it.step === 'processing' || it.step === 'cancelled') && it.questionFileId && (oppIdParam || batchOppId) && (
                            <CancelPipelineButton
                              projectId={projectId}
                              opportunityId={oppIdParam || batchOppId}
                              questionFileId={it.questionFileId}
                              status={it.status || ''}
                              onMutate={refetchStatuses}
                            />
                          )}
                        </div> 
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {items.length > 0 && items.some((i) => i.step !== 'idle') && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg" role="region" aria-label="Batch upload progress">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {allDone ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600"/>
                  ) : hasErrors && completedCount === 0 ? (
                    <XCircle className="h-4 w-4 text-destructive"/>
                  ) : (
                    <Clock className="h-4 w-4 text-primary animate-pulse"/>
                  )}
                  <span className="text-sm font-semibold">Progress</span>
                </div>
                <Badge
                  variant={allDone ? 'default' : hasErrors && completedCount === 0 ? 'destructive' : 'secondary'}
                  className="font-medium"
                >
                  {completedCount} / {items.length} Complete
                </Badge>
              </div>

              <div className="space-y-2">
                <Progress value={(completedCount / items.length) * 100} className="h-2"
                          aria-label="Batch upload progress"/>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>
                    {completedCount} of {items.length} files processed
                  </span>
                  {hasErrors && (
                    <span className="text-destructive">{items.filter((i) => i.step === 'error').length} failed</span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 pt-2">
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="text-lg font-semibold text-foreground">{items.filter((i) => i.step === 'idle').length}</div>
                  <span className="text-xs text-muted-foreground">Queued</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="text-lg font-semibold text-primary">
                    {items.filter((i) => ['uploading', 'starting', 'processing'].includes(i.step)).length}
                  </div>
                  <span className="text-xs text-muted-foreground">Processing</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div className="text-lg font-semibold text-green-600">{completedCount}</div>
                  <span className="text-xs text-muted-foreground">Done</span>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <div
                    className="text-lg font-semibold text-destructive">{items.filter((i) => i.step === 'error').length}</div>
                  <span className="text-xs text-muted-foreground">Failed</span>
                </div>
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive" role="alert">
              <XCircle className="h-4 w-4" aria-hidden="true"/>
              <AlertDescription className="text-sm whitespace-pre-line">
                <span className="font-medium">Error:</span> {error}
              </AlertDescription>
            </Alert>
          )}

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
          <Button type="button" variant="outline" onClick={handleClose} disabled={anyBusy && !allDone}>
            {allDone ? 'Done' : 'Cancel'}
          </Button>

          <Button type="button" onClick={handleStart} disabled={items.length === 0 || anyBusy || !hasProcessableItems}
                  className="gap-2 min-w-[160px]">
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