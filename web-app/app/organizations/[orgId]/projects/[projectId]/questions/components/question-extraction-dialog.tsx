'use client';

import React, { useCallback, useEffect, useState } from 'react';
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
import { usePresignUpload } from '@/lib/hooks/use-presign';
import {
  useCreateQuestionFile,
  useQuestionFileStatus,
  useStartQuestionFilePipeline,
} from '@/lib/hooks/use-question-file';

interface QuestionFileUploadDialogProps {
  projectId: string;
  triggerLabel?: string;
  onCompleted?: (questionFileId: string) => void;
}

export function QuestionFileUploadDialog({
                                           projectId,
                                           triggerLabel = 'Upload Document',
                                           onCompleted,
                                         }: QuestionFileUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [questionFileId, setQuestionFileId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<
    'idle' | 'uploading' | 'starting' | 'processing' | 'done' | 'error'
  >('idle');
  const [dragActive, setDragActive] = useState(false);

  const { trigger: getPresignedUrl, isMutating: isGettingPresigned } = usePresignUpload();
  const { trigger: createQuestionFile } = useCreateQuestionFile(projectId);
  const {
    trigger: startPipeline,
    isMutating: isStartingPipeline,
  } = useStartQuestionFilePipeline(projectId);

  const {
    data: statusData,
    error: statusError,
    mutate: refetchStatus,
  } = useQuestionFileStatus(projectId, questionFileId);

  const resetState = useCallback(() => {
    setFile(null);
    setQuestionFileId(null);
    setError(null);
    setStep('idle');
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  useEffect(() => {
    if (!statusData) return;

    if (statusData.status === 'questions_extracted') {
      setStep('done');
      if (onCompleted) {
        onCompleted(statusData.questionFileId);
      }
    } else if (statusData.status === 'error') {
      setStep('error');
      if (statusData.errorMessage) {
        setError(statusData.errorMessage);
      }
    } else {
      setStep('processing');
    }
  }, [statusData, onCompleted]);

  useEffect(() => {
    if (!statusError) return;
    setError(statusError.message || 'Failed to check processing status');
    setStep('error');
  }, [statusError]);

  useEffect(() => {
    if (!questionFileId) return;
    if (step !== 'processing') return;
    refetchStatus();
  }, [questionFileId, step, refetchStatus]);

  const handleClose = () => {
    window.location.reload();
    setOpen(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    setFile(f);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    setError(null);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const f = e.dataTransfer.files[0];
      const validTypes = ['.pdf', '.doc', '.docx', '.txt'];
      const isValid = validTypes.some(type => f.name.toLowerCase().endsWith(type));

      if (isValid) {
        setFile(f);
      } else {
        setError('Please upload a valid file type (PDF)');
      }
    }
  };

  const handleRemoveFile = () => {
    setFile(null);
    setError(null);
  };

  const handleStart = async () => {
    try {
      setError(null);

      if (!file) {
        setError('Please select a file first.');
        return;
      }

      // 1) Get presigned URL
      setStep('uploading');
      const presigned = await getPresignedUrl({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
      });

      // 2) Upload file to S3 with PUT
      const uploadRes = await fetch(presigned.url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text().catch(() => '');
        throw new Error(text || 'Failed to upload file to S3');
      }

      // 3) create questionFile record in DB
      const { questionFileId } = await createQuestionFile({
        originalFileName: file.name,
        fileKey: presigned.key,
        mimeType: file.type,
      });

      // 4) Start Step Function pipeline for question extraction
      setStep('starting');
      const startRes = await startPipeline({
        projectId,
        questionFileId,
      });

      setQuestionFileId(questionFileId);
      setStep('processing');
    } catch (e: any) {
      console.error('Question file upload/start error', e);
      setError(e?.message || 'Unexpected error');
      setStep('error');
    }
  };

  const isBusy =
    isGettingPresigned || isStartingPipeline || step === 'uploading' || step === 'starting';

  const progressValue = (() => {
    switch (step) {
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
  })();

  const statusLabel = (() => {
    if (error) return 'Error';
    if (statusData?.status === 'questions_extracted') return 'Completed';
    if (statusData?.status === 'text_ready') return 'Text ready, extracting questions';
    if (statusData?.status === 'processing') return 'Processing document';
    if (statusData?.status === 'error') return 'Error';
    switch (step) {
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
  })();

  const StatusIcon = (() => {
    if (step === 'done') return CheckCircle2;
    if (step === 'error') return XCircle;
    if (step === 'uploading' || step === 'starting' || step === 'processing') return Clock;
    return AlertCircle;
  })();

  return (
    <Dialog open={open} onOpenChange={(flag) => {
      flag || window.location.reload();
      setOpen(flag);
    }}>
      <DialogTrigger asChild>
        <Button className="gap-2 px-6 py-2.5 font-medium">
          <Upload className="h-4 w-4"/>
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <FileText className="h-5 w-5"/>
            Upload Question File
          </DialogTitle>
          <DialogDescription>
            Upload a PDF file to extract questions for analysis
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* File Upload Area */}
          <div className="space-y-3">
            <label className="text-sm font-semibold text-foreground">
              Select Document
            </label>

            {!file ? (
              <div
                className={`relative border-2 border-dashed rounded-lg p-8 transition-all ${
                  dragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                } ${isBusy ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.txt"
                  onChange={handleFileChange}
                  disabled={isBusy}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="flex flex-col items-center justify-center space-y-3 text-center">
                  <div className="p-4 bg-primary/10 rounded-full">
                    <Upload className="h-8 w-8 text-primary"/>
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      Drop your file here, or <span className="text-primary">browse</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Supports PDF (max 50MB)
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="border-2 border-primary/50 bg-primary/5 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-primary/10 rounded">
                    <FileText className="h-5 w-5 text-primary"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  {!isBusy && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveFile}
                      className="shrink-0 h-8 w-8 p-0"
                    >
                      <X className="h-4 w-4"/>
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Progress Section */}
          {(step !== 'idle' || questionFileId) && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusIcon className={`h-4 w-4 ${
                    step === 'done' ? 'text-green-600' :
                      step === 'error' ? 'text-destructive' :
                        'text-primary animate-pulse'
                  }`}/>
                  <span className="text-sm font-semibold">Processing Status</span>
                </div>
                <Badge
                  variant={
                    step === 'done'
                      ? 'default'
                      : step === 'error'
                        ? 'destructive'
                        : 'secondary'
                  }
                  className="font-medium"
                >
                  {statusLabel}
                </Badge>
              </div>

              <div className="space-y-2">
                <Progress value={progressValue} className="h-2"/>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{progressValue}% complete</span>
                  {statusData?.updatedAt && (
                    <span>Updated {new Date(statusData.updatedAt).toLocaleTimeString()}</span>
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
                    <div className={`w-2 h-2 rounded-full ${
                      progressValue >= s.value
                        ? 'bg-primary'
                        : 'bg-muted-foreground/20'
                    }`}/>
                    <span className={`text-xs ${
                      progressValue >= s.value
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground'
                    }`}>
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              {questionFileId && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">File ID:</span> {questionFileId}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4"/>
              <AlertDescription className="text-sm">
                <span className="font-medium">Error:</span> {error}
              </AlertDescription>
            </Alert>
          )}

          {/* Success Message */}
          {step === 'done' && (
            <Alert className="border-green-600/50 bg-green-50 dark:bg-green-950/20">
              <CheckCircle2 className="h-4 w-4 text-green-600"/>
              <AlertDescription className="text-sm text-green-900 dark:text-green-100">
                <span className="font-medium">Success!</span> Your document has been processed and questions have been
                extracted.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="flex justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isBusy && step !== 'done'}
          >
            {step === 'done' ? 'Done' : 'Cancel'}
          </Button>
          <Button
            type="button"
            onClick={handleStart}
            disabled={!file || isBusy || step === 'done'}
            className="gap-2 min-w-[140px]"
          >
            {step === 'idle' || step === 'error' ? (
              <>
                <Upload className="h-4 w-4"/>
                Start Processing
              </>
            ) : (
              <>
                <Clock className="h-4 w-4 animate-spin"/>
                Processing…
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}