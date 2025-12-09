'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Upload } from 'lucide-react';

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const f = e.target.files?.[0] ?? null;
    setFile(f);
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

      // use the ID returned by backend (in case they differ)
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
    if (statusData?.status === 'processing') return 'Processing…';
    if (statusData?.status === 'error') return 'Error';
    switch (step) {
      case 'uploading':
        return 'Uploading file…';
      case 'starting':
        return 'Starting pipeline…';
      case 'processing':
        return 'Processing…';
      case 'done':
        return 'Completed';
      default:
        return 'Idle';
    }
  })();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 px-6 py-2.5">
          <Upload className="h-4 w-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload question file</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Select file (PDF / DOCX / etc.)
            </label>
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.txt"
              onChange={handleFileChange}
              disabled={isBusy}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                Selected: <span className="font-medium">{file.name}</span>{' '}
                ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Status</span>
              <Badge
                variant={
                  step === 'done'
                    ? 'default'
                    : step === 'error'
                      ? 'destructive'
                      : 'outline'
                }
              >
                {statusLabel}
              </Badge>
            </div>
            <Progress value={progressValue} className="w-full" />
            {statusData?.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Last update: {new Date(statusData.updatedAt).toLocaleString()}
              </p>
            )}
            {questionFileId && (
              <p className="text-[11px] text-muted-foreground break-all">
                File ID: {questionFileId}
              </p>
            )}
            {error && (
              <p className="text-xs text-destructive mt-1">{error}</p>
            )}
          </div>
        </div>

        <DialogFooter className="flex justify-between space-x-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isBusy}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={handleStart}
            disabled={!file || isBusy}
          >
            {step === 'idle' || step === 'error'
              ? 'Start processing'
              : 'Processing…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
